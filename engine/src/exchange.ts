// resolveExchange: one 30-second exchange. Pure: same inputs + same rng state = same output.
import type { Action, BoxerState, ExchangeOutcome, FightEvent, FightState, Punch, Side } from "./types.js";
import type { Rng } from "./rng.js";
import { CUTS, DAMAGE, DEFEND, EXCHANGE_SECONDS, HURT, LAND, PUNCHES, REFEREE, STAMINA, TACTIC } from "./tuning.js";
import { clone, other } from "./state.js";
import { effAccuracy, effDefence, effPower, effSpeed, gainStamina, spendStamina } from "./stats.js";
import { sanitizeActions } from "./plans.js";
import { chinThreshold, knockdown, knockdownChance, oneSidedCheck } from "./knockdown.js";
import { cutsFromPunch, openCut } from "./cuts.js";

const PUNCH_LIST: readonly Action[] = ["jab", "cross", "hook", "uppercut", "body"];
const isPunch = (a: Action): a is Punch => PUNCH_LIST.includes(a);

interface Window {
  action: Action;
  start: number;
  end: number;
}

interface Ctx {
  s: FightState;
  rng: Rng;
  events: FightEvent[];
  windows: Record<Side, Window[]>;
  headDamageTaken: Record<Side, number>;
  hurtThisExchange: Record<Side, boolean>;
  stopAt: number | null; // set when a knockdown/stoppage ends the action
}

/** Each plan's 1-3 actions split the 30 seconds evenly. */
function windowsFor(actions: Action[]): Window[] {
  const len = EXCHANGE_SECONDS / actions.length;
  return actions.map((action, i) => ({ action, start: i * len, end: (i + 1) * len }));
}

function actionAt(ctx: Ctx, side: Side, t: number): Action {
  const w = ctx.windows[side].find((x) => t >= x.start && t < x.end) ?? ctx.windows[side][ctx.windows[side].length - 1];
  return (w as Window).action;
}

type Beat = { t: number; side: Side; kind: "punch"; punch: Punch } | { t: number; side: Side; kind: "clinch"; end: number };

export function resolveExchange(state: FightState, planA: unknown, planB: unknown, rng: Rng): ExchangeOutcome {
  const s = clone(state);
  if (s.result) return { state: s, events: [], duration: 0 };
  const ctx: Ctx = {
    s,
    rng,
    events: [],
    windows: { a: windowsFor(sanitizeActions(planA).actions), b: windowsFor(sanitizeActions(planB).actions) },
    headDamageTaken: { a: 0, b: 0 },
    hurtThisExchange: { a: false, b: false },
    stopAt: null,
  };

  // Footwork/defence windows tell the 3D layer what stance to hold; punches get their own events.
  const beats: Beat[] = [];
  for (const side of ["a", "b"] as const) {
    for (const w of ctx.windows[side]) {
      ctx.events.push({ t: w.start, type: "action-start", side, action: w.action, duration: w.end - w.start });
      if (w.action === "clinch") beats.push({ t: w.start + 0.5, side, kind: "clinch", end: w.end - 0.5 });
      else if (isPunch(w.action)) {
        const n = PUNCHES[w.action].volley;
        for (let i = 0; i < n; i++) beats.push({ t: w.start + ((w.end - w.start) * (i + 0.5)) / n, side, kind: "punch", punch: w.action });
      }
    }
  }
  // Same moment: the faster boxer goes first (A on a tie).
  const fasterFirst = effSpeed(s.b) > effSpeed(s.a) ? ["b", "a"] : ["a", "b"];
  beats.sort((x, y) => x.t - y.t || fasterFirst.indexOf(x.side) - fasterFirst.indexOf(y.side));

  for (const beat of beats) {
    if (ctx.stopAt !== null) break;
    if (beat.kind === "clinch") clinch(ctx, beat.side, beat.t, beat.end);
    else throwPunch(ctx, beat.side, beat.punch, beat.t, false);
  }

  if (ctx.stopAt === null) afterAction(ctx, planHasPunches(ctx, "a") && planHasPunches(ctx, "b"));

  // Drop stance cues that would have started after the action stopped.
  const stopAt = ctx.stopAt;
  const events = (stopAt === null ? ctx.events : ctx.events.filter((e) => e.type !== "action-start" || e.t <= stopAt))
    .map((e, i) => ({ e, i }))
    .sort((x, y) => x.e.t - y.e.t || x.i - y.i)
    .map(({ e }) => ({ ...e, t: round2(e.t) }) as FightEvent);

  if (!s.result) s.exchange += 1;
  const duration = Math.max(EXCHANGE_SECONDS, ...events.map((e) => e.t));
  return { state: s, events, duration };
}

function planHasPunches(ctx: Ctx, side: Side): boolean {
  return ctx.windows[side].some((w) => isPunch(w.action));
}

function clinch(ctx: Ctx, side: Side, t: number, endT: number): void {
  const b = ctx.s[side];
  b.clinchesRound += 1;
  b.clinchesTotal += 1;
  b.hurt = false; // tying up buys time to clear the head
  gainStamina(b, STAMINA.clinchGain);
  ctx.events.push({ t, type: "clinch", side });
  if (b.clinchesRound >= REFEREE.clinchWarningAt) {
    if (!b.warnedForClinching) {
      b.warnedForClinching = true;
      ctx.events.push({ t: t + 1, type: "warning", side, reason: "excessive holding" });
    } else {
      b.deductions += 1;
      b.deductionsRound += 1;
      ctx.events.push({ t: t + 1, type: "deduction", side, points: 1, reason: "repeated holding after a warning" });
    }
  }
  ctx.events.push({ t: endT, type: "break", side });
}

function throwPunch(ctx: Ctx, side: Side, punch: Punch, t: number, counter: boolean): void {
  const { s, rng, events } = ctx;
  const att = s[side];
  const defSide = other(side);
  const def = s[defSide];
  const spec = PUNCHES[punch];
  const defAction = actionAt(ctx, defSide, t);

  if (!counter && defAction === "clinch") {
    events.push({ t, type: "smothered", side, punch });
    return;
  }

  const costMult = TACTIC[att.tactic].cost * (att.bodyHealth < 50 ? STAMINA.lowBodyCostMultiplier : 1);
  spendStamina(att, spec.stamina * costMult);
  s.roundStats[side].thrown += 1;
  events.push({ t, type: "throw", side, punch, hand: spec.hand, counter });

  let land =
    spec.baseLand +
    LAND.perAccuracyVsDefence * (effAccuracy(att) - effDefence(def)) +
    LAND.perSpeed * (effSpeed(att) - effSpeed(def)) +
    TACTIC[att.tactic].land +
    (def.hurt ? LAND.hurtDefenderBonus : 0);
  let damageMult = 1;

  if (counter) {
    land += DEFEND.counterLandBonus + LAND.bothPunchingBonus + (att.build.style === "counter-puncher" ? DEFEND.counterPuncherBonus : 0);
  } else if (defAction === "block") {
    let blockChance = DEFEND.blockBase + DEFEND.blockPerDefence * effDefence(def);
    if (punch === "uppercut") blockChance *= DEFEND.blockVsUppercut;
    if (rng.chance(blockChance)) {
      events.push({ t: t + 0.2, type: "block", side: defSide, punch });
      spendStamina(def, STAMINA.blockCost);
      s.roundStats[defSide].blocked += 1;
      const leak = rollDamage(ctx, side, punch) * DEFEND.blockedDamage;
      applyDamage(def, spec.target, leak);
      return;
    }
  } else if (defAction === "slip") {
    const slipChance = spec.straight
      ? DEFEND.slipStraightBase + DEFEND.slipStraightPerDefence * effDefence(def)
      : punch === "body"
        ? 0
        : DEFEND.slipCurvedBase + DEFEND.slipCurvedPerDefence * effDefence(def);
    if (rng.chance(slipChance)) {
      events.push({ t: t + 0.2, type: "slip", side: defSide, punch });
      s.roundStats[defSide].slipped += 1;
      if (spec.straight) {
        s.roundStats[defSide].counters += 1;
        throwPunch(ctx, defSide, def.build.style === "slugger" ? "hook" : "cross", t + 0.5, true);
      }
      return;
    }
    if (!spec.straight && punch !== "body") damageMult = DEFEND.slippedIntoMultiplier;
  } else if (defAction === "move") {
    let malus = LAND.moveMalus + (def.build.style === "out-boxer" ? LAND.outBoxerMoveExtra : 0);
    if (att.tactic === "pressure") {
      malus *= LAND.pressureCutsOffRing;
      if (att.build.style === "swarmer") malus *= LAND.swarmerCutsOffRing;
    }
    land -= malus;
  } else if (isPunch(defAction)) {
    land += LAND.bothPunchingBonus;
  }

  land = Math.min(LAND.max, Math.max(LAND.min, land));
  if (!rng.chance(land)) {
    events.push({ t: t + 0.25, type: "miss", side, punch });
    return;
  }
  landPunch(ctx, side, punch, t + 0.25, counter, damageMult);
}

function rollDamage(ctx: Ctx, side: Side, punch: Punch): number {
  const att = ctx.s[side];
  const spec = PUNCHES[punch];
  let dmg = spec.damage * (DAMAGE.powerBase + DAMAGE.powerPerStat * effPower(att)) * TACTIC[att.tactic].damage;
  if (att.build.style === "slugger" && spec.power && punch !== "body") dmg *= DAMAGE.sluggerPowerPunch;
  if (att.build.style === "swarmer" && punch === "body") dmg *= DAMAGE.swarmerBody;
  return dmg * (1 + ctx.rng.range(-DAMAGE.variance, DAMAGE.variance));
}

function applyDamage(def: BoxerState, target: "head" | "body", dmg: number): void {
  if (target === "head") def.headHealth = Math.max(0, def.headHealth - dmg);
  else {
    def.bodyHealth = Math.max(0, def.bodyHealth - dmg);
    spendStamina(def, dmg * STAMINA.bodyDrainPerDamage);
  }
}

function landPunch(ctx: Ctx, side: Side, punch: Punch, t: number, counter: boolean, damageMult: number): void {
  const { s, rng, events } = ctx;
  const att = s[side];
  const defSide = other(side);
  const def = s[defSide];
  const spec = PUNCHES[punch];
  let dmg = rollDamage(ctx, side, punch) * damageMult;
  if (counter && att.build.style === "counter-puncher") dmg *= DEFEND.counterPuncherDamage;
  dmg = Math.round(dmg * 10) / 10;

  applyDamage(def, spec.target, dmg);
  const stats = s.roundStats[side];
  stats.landed += 1;
  stats.damage += dmg;
  if (spec.power) stats.powerLanded += 1;
  events.push({ t, type: "land", side, punch, target: spec.target, damage: dmg, counter });

  if (spec.target === "head") {
    ctx.headDamageTaken[defSide] += dmg;
    cutsFromPunch(def, defSide, punch, dmg, t + 0.1, s.round, rng, events);
    const kdChance = knockdownChance(def, dmg, att.build.style === "slugger" && spec.power);
    if (dmg >= HURT.fraction * chinThreshold(def)) {
      if (!def.hurt) events.push({ t: t + 0.2, type: "hurt", side: defSide });
      def.hurt = true;
      ctx.hurtThisExchange[defSide] = true;
    }
    if (kdChance > 0 && rng.chance(kdChance)) {
      ctx.stopAt = knockdown(s, defSide, punch, t + 0.4, rng, events);
    }
  } else if (def.bodyHealth < 25 && rng.chance(0.04 * dmg)) {
    // A body shot can fold a boxer whose body is already beaten up.
    ctx.stopAt = knockdown(s, defSide, punch, t + 0.4, rng, events);
  }
}

/** End of the 30 seconds: head clashes, referee looks, recovery, hurt wears off. */
function afterAction(ctx: Ctx, bothPunching: boolean): void {
  const { s, rng, events } = ctx;
  const mixed = s.a.build.stance !== s.b.build.stance;
  const clashChance = bothPunching ? CUTS.headClashChance * (mixed ? CUTS.mixedStanceClashMultiplier : 1) : 0;
  if (rng.chance(clashChance)) {
    const t = rng.range(2, 28);
    events.push({ t, type: "head-clash" });
    for (const side of ["a", "b"] as const) {
      if (rng.chance(CUTS.clashCutChance)) openCut(s[side], side, "clash", 1, t + 0.2, s.round, rng, events);
    }
  }
  for (const side of ["a", "b"] as const) {
    oneSidedCheck(s, side, ctx.headDamageTaken[side], EXCHANGE_SECONDS - 0.5, rng, events);
    if (s.result) return;
  }
  for (const side of ["a", "b"] as const) {
    const b = s[side];
    gainStamina(b, STAMINA.exchangeRecoveryBase + STAMINA.exchangeRecoveryPerStat * b.build.stats.stamina);
    // Hurt carries into the next exchange, then clears unless it happened again.
    b.hurt = ctx.hurtThisExchange[side];
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
