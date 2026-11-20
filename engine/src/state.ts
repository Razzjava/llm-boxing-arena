// Creating fight state and the read-only view a controller sees.
import type { BoxerBuild, BoxerState, FightState, RoundStats, Side } from "./types.js";
import { STAMINA, EXCHANGE_SECONDS } from "./tuning.js";
import { newScorecards } from "./judging.js";

export function maxStaminaFor(build: BoxerBuild): number {
  return STAMINA.baseMax + build.stats.stamina * STAMINA.perStat;
}

export function newBoxerState(build: BoxerBuild): BoxerState {
  const maxStamina = maxStaminaFor(build);
  return {
    build,
    headHealth: 100,
    bodyHealth: 100,
    stamina: maxStamina,
    maxStamina,
    cuts: [],
    hurt: false,
    tactic: "box",
    knockdownsRound: 0,
    knockdownsTotal: 0,
    clinchesRound: 0,
    clinchesTotal: 0,
    warnedForClinching: false,
    deductions: 0,
    deductionsRound: 0,
  };
}

export function emptyRoundStats(): RoundStats {
  return { thrown: 0, landed: 0, powerLanded: 0, damage: 0, blocked: 0, slipped: 0, counters: 0, knockdownsScored: 0 };
}

export function createFight(a: BoxerBuild, b: BoxerBuild): FightState {
  return {
    round: 1,
    exchange: 1,
    a: newBoxerState(a),
    b: newBoxerState(b),
    roundStats: { a: emptyRoundStats(), b: emptyRoundStats() },
    scorecards: newScorecards(),
    result: null,
  };
}

export function other(side: Side): Side {
  return side === "a" ? "b" : "a";
}

/** Deep copy via JSON. State is plain data, so this is safe and keeps resolve functions pure. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface BoxerView {
  name: string;
  nickname: string;
  stance: string;
  style: string;
  stats: BoxerBuild["stats"];
  headHealth: number;
  bodyHealth: number;
  staminaPercent: number;
  hurt: boolean;
  cuts: { location: string; severity: number }[];
  knockdownsThisRound: number;
  knockdownsTotal: number;
  clinchesThisRound: number;
  pointDeductions: number;
  tactic: string;
}

/** What a controller (an LLM, later) is shown. Judges' cards stay hidden. */
export interface FightStateView {
  phase: "corner" | "exchange";
  you: Side;
  round: number;
  exchange: number;
  clockSeconds: number;
  me: BoxerView;
  opponent: BoxerView;
  thisRound: { myLanded: number; opponentLanded: number; myThrown: number; opponentThrown: number };
  lastExchange: string[];
}

export function viewFor(state: FightState, side: Side, phase: "corner" | "exchange", lastExchange: string[]): FightStateView {
  const mine = state.roundStats[side];
  const theirs = state.roundStats[other(side)];
  return {
    phase,
    you: side,
    round: state.round,
    exchange: phase === "corner" ? 0 : state.exchange,
    clockSeconds: phase === "corner" ? 0 : (state.exchange - 1) * EXCHANGE_SECONDS,
    me: boxerView(state[side]),
    opponent: boxerView(state[other(side)]),
    thisRound: { myLanded: mine.landed, opponentLanded: theirs.landed, myThrown: mine.thrown, opponentThrown: theirs.thrown },
    lastExchange: [...lastExchange],
  };
}

function boxerView(b: BoxerState): BoxerView {
  return {
    name: b.build.name,
    nickname: b.build.nickname,
    stance: b.build.stance,
    style: b.build.style,
    stats: { ...b.build.stats },
    headHealth: Math.round(b.headHealth),
    bodyHealth: Math.round(b.bodyHealth),
    staminaPercent: Math.round((100 * b.stamina) / b.maxStamina),
    hurt: b.hurt,
    cuts: b.cuts.map((c) => ({ location: c.location, severity: c.severity })),
    knockdownsThisRound: b.knockdownsRound,
    knockdownsTotal: b.knockdownsTotal,
    clinchesThisRound: b.clinchesRound,
    pointDeductions: b.deductions,
    tactic: b.tactic,
  };
}
