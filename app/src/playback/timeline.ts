// Flattens a FightLog into one playback timeline measured in "fight seconds".
// Everything the 3D scene and HUD show is a pure function of (timeline, T), so pausing, speed changes,
// skipping and slow-mo replays are just different ways of moving T.
import {
  createFight, createRng, endRound, resolveExchange,
  type ExchangeLog, type FightEvent, type FightLog, type FightState, type RoundLog, type Side,
} from "@llm-boxing-arena/engine";

type LoggedPlan = ExchangeLog["plans"]["a"];
type LoggedCorner = RoundLog["corner"]["a"];

export const INTRO_SECONDS = 8;
export const BREAK_SECONDS = 12;
export const RESULT_SECONDS = 16;
/** Fight seconds per real second at 1x. A 30s exchange plays in 7.5s. */
export const BASE_RATE = 4;

export interface Vitals {
  head: number;
  body: number;
  stamina: number; // percent
  hurt: boolean;
  knockdowns: number;
  cut: number; // worst cut severity, 0 = none
}

export interface TimedEvent {
  T: number; // global fight-seconds
  e: FightEvent;
}

interface Base {
  index: number;
  start: number;
  duration: number;
  round: number;
  before: { a: Vitals; b: Vitals };
  after: { a: Vitals; b: Vitals };
}
export type Segment =
  | (Base & { kind: "intro"; corner: { a: LoggedCorner; b: LoggedCorner } })
  | (Base & { kind: "exchange"; exchange: number; events: TimedEvent[]; plans: { a: LoggedPlan; b: LoggedPlan } })
  | (Base & { kind: "break"; events: TimedEvent[]; nextCorner: { a: LoggedCorner; b: LoggedCorner } | null })
  | (Base & { kind: "result" });

export interface Timeline {
  log: FightLog;
  segments: Segment[];
  duration: number;
  /** Global time each knockdown happened, for instant replays and camera cuts. */
  knockdowns: { T: number; side: Side; segment: number }[];
  /** Start of the result segment (what "skip to result" jumps to). */
  resultStart: number;
}

export function vitalsOf(s: FightState, side: Side): Vitals {
  const b = s[side];
  return {
    head: b.headHealth,
    body: b.bodyHealth,
    stamina: (100 * b.stamina) / b.maxStamina,
    hurt: b.hurt,
    knockdowns: b.knockdownsTotal,
    cut: b.cuts.reduce((m, c) => Math.max(m, c.severity), 0),
  };
}

/**
 * Steps the engine through the log exactly like runFight/replayFight does, keeping the state after
 * every exchange. Returns the final state too so tests can prove it matches the log.
 */
export function buildTimeline(log: FightLog): Timeline & { finalState: FightState } {
  const rng = createRng(log.seed);
  let state = createFight(log.builds.a, log.builds.b);
  const segments: Segment[] = [];
  const knockdowns: Timeline["knockdowns"] = [];
  let T = 0;
  const snap = () => ({ a: vitalsOf(state, "a"), b: vitalsOf(state, "b") });
  type NewSegment = Segment extends infer S ? (S extends Segment ? Omit<S, "index"> : never) : never;
  const push = (seg: NewSegment) => {
    segments.push({ ...seg, index: segments.length } as Segment);
    T += seg.duration;
  };

  const first = log.rounds[0];
  if (first) {
    const v = snap();
    push({ kind: "intro", start: 0, duration: INTRO_SECONDS, round: 1, before: v, after: v, corner: first.corner });
  }

  log.rounds.forEach((r, ri) => {
    state.a.tactic = r.corner.a.tactic;
    state.b.tactic = r.corner.b.tactic;
    for (const x of r.exchanges) {
      const before = snap();
      const out = resolveExchange(state, x.plans.a, x.plans.b, rng);
      state = out.state;
      const start = T;
      const events = x.events.map((e) => ({ T: start + e.t, e }));
      for (const te of events) if (te.e.type === "knockdown") knockdowns.push({ T: te.T, side: te.e.side, segment: segments.length });
      push({ kind: "exchange", start, duration: x.duration, round: r.round, exchange: x.exchange, events, plans: x.plans, before, after: snap() });
    }
    if (!state.result) {
      const before = snap();
      const between = endRound(state, rng);
      state = between.state;
      const start = T;
      const next = log.rounds[ri + 1];
      push({
        kind: "break", start, duration: BREAK_SECONDS, round: r.round,
        events: between.events.map((e) => ({ T: start + Math.min(e.t, BREAK_SECONDS - 1), e })),
        nextCorner: next ? next.corner : null, before, after: snap(),
      });
    }
  });

  const resultStart = T;
  const v = snap();
  push({ kind: "result", start: T, duration: RESULT_SECONDS, round: log.result.round, before: v, after: v });
  return { log, segments, duration: T, knockdowns, resultStart, finalState: state };
}

export function segmentAt(tl: Timeline, T: number): Segment {
  const segs = tl.segments;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((segs[mid] as Segment).start <= T) lo = mid;
    else hi = mid - 1;
  }
  return segs[lo] as Segment;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Health drops punch by punch, stamina drains smoothly. */
export function vitalsAt(tl: Timeline, T: number): { a: Vitals; b: Vitals } {
  const seg = segmentAt(tl, T);
  if (seg.kind !== "exchange" && seg.kind !== "break") return seg.after;
  const local = Math.max(0, Math.min(1, (T - seg.start) / seg.duration));
  const out = { a: { ...seg.before.a }, b: { ...seg.before.b } };
  for (const side of ["a", "b"] as const) {
    const from = seg.before[side];
    const to = seg.after[side];
    let k = local;
    if (seg.kind === "exchange") {
      const hits = seg.events.filter((x) => x.e.type === "land" && x.e.side !== side);
      const done = hits.filter((x) => x.T <= T).length;
      k = hits.length ? done / hits.length : local;
      const hurtAt = seg.events.find((x) => x.e.type === "hurt" && x.e.side === side);
      out[side].hurt = hurtAt ? T >= hurtAt.T : from.hurt && local < 1 ? from.hurt : to.hurt;
      const kdDone = seg.events.filter((x) => x.e.type === "knockdown" && x.e.side === side && x.T <= T).length;
      out[side].knockdowns = from.knockdowns + kdDone;
      const cutAt = seg.events.find((x) => (x.e.type === "cut-opened" || x.e.type === "cut-worsened") && x.e.side === side);
      out[side].cut = cutAt && T >= cutAt.T ? to.cut : from.cut;
    } else {
      out[side].hurt = to.hurt;
      out[side].knockdowns = to.knockdowns;
      out[side].cut = local > 0.5 ? to.cut : from.cut;
    }
    out[side].head = lerp(from.head, to.head, k);
    out[side].body = lerp(from.body, to.body, k);
    out[side].stamina = lerp(from.stamina, to.stamina, local);
  }
  return out;
}

export function clockAt(tl: Timeline, T: number): { round: number; label: string } {
  const seg = segmentAt(tl, T);
  if (seg.kind === "exchange") {
    const secs = Math.min(180, (seg.exchange - 1) * 30 + Math.min(30, T - seg.start));
    const m = Math.floor(secs / 60);
    return { round: seg.round, label: `${m}:${String(Math.floor(secs % 60)).padStart(2, "0")}` };
  }
  if (seg.kind === "break") return { round: seg.round, label: "REST" };
  if (seg.kind === "intro") return { round: 1, label: "0:00" };
  return { round: seg.round, label: "FINAL" };
}
