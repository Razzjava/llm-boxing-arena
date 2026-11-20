// runFight: the whole 12 rounds, driven by two controllers (scripted bots now, LLMs later).
import type { BoxerBuild, FightEvent, FightResult, FightState, Plan, Side, Tactic } from "./types.js";
import { createRng, type Rng } from "./rng.js";
import { normalizeBuild } from "./boxer.js";
import { createFight, other, viewFor, type FightStateView } from "./state.js";
import { resolveExchange } from "./exchange.js";
import { endRound } from "./round.js";
import { sanitizeActions, sanitizeTactic, type CleanPlan } from "./plans.js";
import { EXCHANGES_PER_ROUND } from "./tuning.js";

/** A controller sees the fight and returns a plan. Async so an LLM call can sit behind it. */
export type Controller = (view: FightStateView) => Promise<Plan | unknown> | Plan | unknown;

export interface LoggedPlan {
  actions: CleanPlan["actions"];
  talk: string;
  /** True if the controller's answer was unusable and block+move was used. */
  fallback: boolean;
  error?: string;
}

export interface LoggedCorner {
  tactic: Tactic;
  talk: string;
  fallback: boolean;
  error?: string;
}

export interface ExchangeLog {
  exchange: number;
  plans: { a: LoggedPlan; b: LoggedPlan };
  events: FightEvent[];
  duration: number;
}

export interface RoundLog {
  round: number;
  corner: { a: LoggedCorner; b: LoggedCorner };
  exchanges: ExchangeLog[];
  /** Round end, scoring, cutman, doctor. */
  betweenRounds: FightEvent[];
}

export interface FightLog {
  version: 1;
  seed: number;
  builds: { a: BoxerBuild; b: BoxerBuild };
  buildFixes: { a: string[]; b: string[] };
  rounds: RoundLog[];
  result: FightResult;
  finalState: FightState;
}

export interface RunOptions {
  /** Max wait for a controller answer before falling back. Default 30s. */
  timeoutMs?: number;
}

type PlanSource = {
  corner(side: Side, view: FightStateView): Promise<LoggedCorner>;
  exchange(side: Side, view: FightStateView): Promise<LoggedPlan>;
};

export async function runFight(
  boxerA: unknown,
  boxerB: unknown,
  controllerA: Controller,
  controllerB: Controller,
  seed: number,
  options: RunOptions = {},
): Promise<FightLog> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const a = normalizeBuild(boxerA, "Boxer A");
  const b = normalizeBuild(boxerB, "Boxer B");
  const controllers = { a: controllerA, b: controllerB };
  const source: PlanSource = {
    async corner(side, view) {
      const { value, error } = await ask(controllers[side], view, timeoutMs);
      const clean = sanitizeTactic(value);
      return error ? { ...clean, fallback: true, error } : clean;
    },
    async exchange(side, view) {
      const { value, error } = await ask(controllers[side], view, timeoutMs);
      const clean = sanitizeActions(value);
      return error ? { ...clean, fallback: true, error } : clean;
    },
  };
  return simulate(a.build, b.build, { a: a.fixes, b: b.fixes }, seed, source);
}

/** Re-run a saved fight from its log. Plans come from the log, so no controllers are called. */
export async function replayFight(log: FightLog): Promise<FightLog> {
  const corners = { a: [] as LoggedCorner[], b: [] as LoggedCorner[] };
  const plans = { a: [] as LoggedPlan[], b: [] as LoggedPlan[] };
  for (const r of log.rounds) {
    for (const side of ["a", "b"] as const) {
      corners[side].push(r.corner[side]);
      for (const x of r.exchanges) plans[side].push(x.plans[side]);
    }
  }
  const source: PlanSource = {
    async corner(side) {
      return corners[side].shift() ?? { tactic: "box", talk: "", fallback: true, error: "missing from log" };
    },
    async exchange(side) {
      return plans[side].shift() ?? { actions: ["block", "move"], talk: "", fallback: true, error: "missing from log" };
    },
  };
  return simulate(log.builds.a, log.builds.b, log.buildFixes, log.seed, source);
}

async function simulate(
  buildA: BoxerBuild, buildB: BoxerBuild, buildFixes: FightLog["buildFixes"], seed: number, source: PlanSource,
): Promise<FightLog> {
  const rng: Rng = createRng(seed);
  let state = createFight(buildA, buildB);
  const rounds: RoundLog[] = [];
  let last: Record<Side, string[]> = { a: [], b: [] };

  while (!state.result) {
    const [cornerA, cornerB] = await Promise.all([
      source.corner("a", viewFor(state, "a", "corner", last.a)),
      source.corner("b", viewFor(state, "b", "corner", last.b)),
    ]);
    state.a.tactic = cornerA.tactic;
    state.b.tactic = cornerB.tactic;
    const roundLog: RoundLog = { round: state.round, corner: { a: cornerA, b: cornerB }, exchanges: [], betweenRounds: [] };
    rounds.push(roundLog);

    while (!state.result && state.exchange <= EXCHANGES_PER_ROUND) {
      // Both plans are collected before resolving, so neither side sees the other's choice.
      const [planA, planB] = await Promise.all([
        source.exchange("a", viewFor(state, "a", "exchange", last.a)),
        source.exchange("b", viewFor(state, "b", "exchange", last.b)),
      ]);
      const exchange = state.exchange;
      const out = resolveExchange(state, planA, planB, rng);
      state = out.state;
      roundLog.exchanges.push({ exchange, plans: { a: planA, b: planB }, events: out.events, duration: out.duration });
      last = { a: summarize(out.events, "a"), b: summarize(out.events, "b") };
    }

    if (!state.result) {
      const between = endRound(state, rng);
      state = between.state;
      roundLog.betweenRounds = between.events;
    }
  }

  const result: FightResult = { ...(state.result as FightResult), scorecards: state.scorecards };
  state.result = result;
  return { version: 1, seed, builds: { a: buildA, b: buildB }, buildFixes, rounds, result, finalState: state };
}

/** Short plain-English recap of the last exchange from one side's point of view. */
export function summarize(events: FightEvent[], side: Side): string[] {
  const opp = other(side);
  const count = (type: FightEvent["type"], who: Side) => events.filter((e) => e.type === type && "side" in e && e.side === who).length;
  const lines = [
    `You landed ${count("land", side)} of ${count("throw", side)} punches.`,
    `Opponent landed ${count("land", opp)} of ${count("throw", opp)} punches.`,
  ];
  if (count("slip", side) > 0) lines.push(`You slipped ${count("slip", side)} punches.`);
  if (count("block", side) > 0) lines.push(`You blocked ${count("block", side)} punches.`);
  if (count("hurt", side) > 0) lines.push("You were hurt.");
  if (count("hurt", opp) > 0) lines.push("You hurt your opponent.");
  if (count("knockdown", side) > 0) lines.push("You were knocked down.");
  if (count("knockdown", opp) > 0) lines.push("You knocked your opponent down.");
  if (count("cut-opened", side) > 0) lines.push("You have a new cut.");
  if (count("warning", side) > 0) lines.push("The referee warned you for holding.");
  if (count("deduction", side) > 0) lines.push("The referee took a point from you for holding.");
  return lines;
}

async function ask(controller: Controller, view: FightStateView, timeoutMs: number): Promise<{ value: unknown; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs}ms`)), timeoutMs);
    });
    const value = await Promise.race([Promise.resolve().then(() => controller(view)), timeout]);
    return { value };
  } catch (err) {
    return { value: undefined, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
