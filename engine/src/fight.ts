// runFight: the whole bout (see ROUNDS), driven by two controllers (scripted bots or model calls).
// A failed, timed-out or unusable answer aborts the match. No stock move is substituted.
import type { BoxerBuild, FightEvent, FightResult, FightState, Side } from "./types.js";
import { createRng, type Rng } from "./rng.js";
import { acceptBuild } from "./boxer.js";
import { createFight, other, viewFor, type FightStateView } from "./state.js";
import { resolveExchange } from "./exchange.js";
import { endRound } from "./round.js";
import { sanitizeActions, sanitizeTactic, type CleanPlan, type CleanTactic } from "./plans.js";
import { EXCHANGES_PER_ROUND } from "./tuning.js";

/**
 * A controller sees the fight and returns a plan. Async so an LLM call can sit behind it.
 * `signal` aborts when the answer deadline passes or the match is stopping.
 */
export type Controller = (view: FightStateView, signal?: AbortSignal) => Promise<unknown> | unknown;

/** A model (or test) that returns a raw boxer build. Demo fights pass a build object instead. */
export type BuildProvider = (signal?: AbortSignal) => Promise<unknown> | unknown;

export interface LoggedPlan {
  actions: CleanPlan["actions"];
  talk: string;
}

export interface LoggedCorner {
  tactic: CleanTactic["tactic"];
  talk: string;
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

/** Per-call deadline when the caller does not pass one. Matches the app's model timeout. */
export const DEFAULT_CALL_TIMEOUT_MS = 120_000;

export interface RunOptions {
  /** Max wait for one controller answer before the match is aborted. Default {@link DEFAULT_CALL_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** The match stopped before a winner. Nothing was scored. */
export interface FightAbort {
  status: "aborted";
  side: Side;
  /** "boxer pick", "round 4 corner tactic", or "round 4, exchange 2 action". */
  step: string;
  reason: string;
}

export type FightOutcome = { status: "completed"; log: FightLog } | FightAbort;

export function timeoutReason(timeoutMs: number): string {
  if (timeoutMs >= 1000 && timeoutMs % 1000 === 0) return `timeout after ${timeoutMs / 1000}s`;
  return `timeout after ${timeoutMs}ms`;
}

type StepResult<T> = { ok: true; value: T } | { ok: false; reason: string };

type PlanSource = {
  corner(side: Side, view: FightStateView): Promise<StepResult<LoggedCorner>>;
  exchange(side: Side, view: FightStateView): Promise<StepResult<LoggedPlan>>;
};

export async function runFight(
  boxerA: unknown,
  boxerB: unknown,
  controllerA: Controller,
  controllerB: Controller,
  seed: number,
  options: RunOptions = {},
): Promise<FightOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const builtA = await obtainBuild(boxerA, timeoutMs);
  if (!builtA.ok) return abort("a", "boxer pick", builtA.reason);
  const builtB = await obtainBuild(boxerB, timeoutMs);
  if (!builtB.ok) return abort("b", "boxer pick", builtB.reason);

  const controllers = { a: controllerA, b: controllerB };
  const source: PlanSource = {
    async corner(side, view) {
      const asked = await callWithDeadline((signal) => controllers[side](view, signal), timeoutMs);
      if (!asked.ok) return asked;
      const parsed = sanitizeTactic(asked.value);
      if (!parsed.ok) return parsed;
      return { ok: true, value: parsed.plan };
    },
    async exchange(side, view) {
      const asked = await callWithDeadline((signal) => controllers[side](view, signal), timeoutMs);
      if (!asked.ok) return asked;
      const parsed = sanitizeActions(asked.value);
      if (!parsed.ok) return parsed;
      return { ok: true, value: parsed.plan };
    },
  };
  return simulate(builtA.value, builtB.value, { a: [], b: [] }, seed, source);
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
      const plan = corners[side].shift();
      if (!plan) return { ok: false, reason: "fight log is missing a corner tactic" };
      const parsed = sanitizeTactic(plan);
      if (!parsed.ok) return parsed;
      // Keep the logged object so a completed file replays to the same JSON.
      return { ok: true, value: plan };
    },
    async exchange(side) {
      const plan = plans[side].shift();
      if (!plan) return { ok: false, reason: "fight log is missing an exchange plan" };
      const parsed = sanitizeActions(plan);
      if (!parsed.ok) return parsed;
      return { ok: true, value: plan };
    },
  };
  const outcome = await simulate(log.builds.a, log.builds.b, log.buildFixes, log.seed, source);
  if (outcome.status === "aborted") {
    throw new Error(`This fight log cannot be replayed (${outcome.step}: ${outcome.reason}).`);
  }
  return outcome.log;
}

async function obtainBuild(input: unknown, timeoutMs: number): Promise<StepResult<BoxerBuild>> {
  if (typeof input !== "function") return stepBuild(acceptBuild(input));
  const asked = await callWithDeadline((signal) => (input as BuildProvider)(signal), timeoutMs);
  if (!asked.ok) return asked;
  return stepBuild(acceptBuild(asked.value));
}

function stepBuild(accepted: ReturnType<typeof acceptBuild>): StepResult<BoxerBuild> {
  if (!accepted.ok) return accepted;
  return { ok: true, value: accepted.build };
}

async function simulate(
  buildA: BoxerBuild, buildB: BoxerBuild, buildFixes: FightLog["buildFixes"], seed: number, source: PlanSource,
): Promise<FightOutcome> {
  const rng: Rng = createRng(seed);
  let state = createFight(buildA, buildB);
  const rounds: RoundLog[] = [];
  let last: Record<Side, string[]> = { a: [], b: [] };

  while (!state.result) {
    // One side at a time: A's answer (or its failure) lands before B is asked.
    // Both plans are still in hand before the exchange is resolved, so neither
    // fighter sees the other's choice. Same seed and same answers stay identical.
    const cornerA = await source.corner("a", viewFor(state, "a", "corner", last.a));
    if (!cornerA.ok) return abort("a", `round ${state.round} corner tactic`, cornerA.reason);
    const cornerB = await source.corner("b", viewFor(state, "b", "corner", last.b));
    if (!cornerB.ok) return abort("b", `round ${state.round} corner tactic`, cornerB.reason);
    state.a.tactic = cornerA.value.tactic;
    state.b.tactic = cornerB.value.tactic;
    const roundLog: RoundLog = {
      round: state.round,
      corner: { a: cornerA.value, b: cornerB.value },
      exchanges: [],
      betweenRounds: [],
    };
    rounds.push(roundLog);

    while (!state.result && state.exchange <= EXCHANGES_PER_ROUND) {
      const planA = await source.exchange("a", viewFor(state, "a", "exchange", last.a));
      if (!planA.ok) return abort("a", `round ${state.round}, exchange ${state.exchange} action`, planA.reason);
      const planB = await source.exchange("b", viewFor(state, "b", "exchange", last.b));
      if (!planB.ok) return abort("b", `round ${state.round}, exchange ${state.exchange} action`, planB.reason);
      const exchange = state.exchange;
      const out = resolveExchange(state, planA.value, planB.value, rng);
      state = out.state;
      roundLog.exchanges.push({ exchange, plans: { a: planA.value, b: planB.value }, events: out.events, duration: out.duration });
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
  return {
    status: "completed",
    log: { version: 1, seed, builds: { a: buildA, b: buildB }, buildFixes, rounds, result, finalState: state },
  };
}

function abort(side: Side, step: string, reason: string): FightAbort {
  return { status: "aborted", side, step, reason };
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

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, " ").trim().slice(0, 240);
}

function isTimeoutMessage(msg: string): boolean {
  return /timed out|\babort/i.test(msg);
}

async function callWithDeadline(
  run: (signal: AbortSignal) => Promise<unknown> | unknown,
  timeoutMs: number,
): Promise<StepResult<unknown>> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Catch rejections here so a controller that fails after the deadline cannot
  // surface as an unhandled rejection once the match has stopped.
  const pending = Promise.resolve().then(() => run(ac.signal));
  const settled = pending.then(
    (value) => ({ ok: true as const, value }),
    (err: unknown) => {
      const message = errorText(err);
      return { ok: false as const, reason: isTimeoutMessage(message) ? timeoutReason(timeoutMs) : message || "request failed" };
    },
  );
  const timedOut = new Promise<{ ok: false; reason: string }>((resolve) => {
    timer = setTimeout(() => {
      ac.abort();
      resolve({ ok: false, reason: timeoutReason(timeoutMs) });
    }, timeoutMs);
  });

  try {
    const winner = await Promise.race([
      settled.then((result) => ({ via: "answer" as const, result })),
      timedOut.then((result) => ({ via: "timeout" as const, result })),
    ]);
    if (winner.via === "answer") return winner.result;

    // The request is already aborted. Wait one turn so a controller that honors
    // the signal can reject before we return. A controller that ignores it is cut off.
    await Promise.race([
      settled.then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 0)),
    ]);
    return winner.result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
