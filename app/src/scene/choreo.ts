// Where everyone stands and what they're doing at fight-time T. Pure functions of (timeline, T),
// so playback, skipping and slow-mo replays all agree. The Boxer/Referee components turn this into bones.
import type { Action, Punch, Side } from "@llm-boxing-arena/engine";
import { segmentAt, type Segment, type Timeline, type TimedEvent } from "../playback/timeline";
import { extensionAt, hardLandRate, landEnvelope, recoilEnvelope, slipEnvelope } from "./impact";

export const CANVAS_Y = 1.0; // top of the tevy ring canvas
export const RING_HALF = 2.75; // keep feet inside the ropes (ropes at 3.11)
// The tevy ring has its red pad at (+x,+z) and blue at (-x,-z).
export const CORNER: Record<Side, Vec2> = { a: { x: 2.55, z: 2.55 }, b: { x: -2.55, z: -2.55 } };
const NEUTRALS: Vec2[] = [{ x: 2.45, z: -2.45 }, { x: -2.45, z: 2.45 }];

export interface Vec2 { x: number; z: number }
export type Mode = "fight" | "down" | "rising" | "walk" | "sit" | "stand" | "victory" | "defeated";

export interface BoxerPose {
  pos: Vec2;
  yaw: number;
  mode: Mode;
  /** Fight-seconds since the current mode started (drives one-shot clips). */
  modeTime: number;
  /** Arm raised by the referee at the end. */
  raised: boolean;
}

export interface RefPose {
  pos: Vec2;
  yaw: number;
  action: "watch" | "break" | "count" | "wave" | "raise" | "walk";
  /** 0..1 within one arm swing of the count, or time since a wave/raise started. */
  phase: number;
  raise: Side | "both" | null;
}

export interface Layout {
  a: BoxerPose;
  b: BoxerPose;
  ref: RefPose;
  /** Where the action is, for cameras. */
  focus: Vec2;
  knockdownSide: Side | null;
  /** Between rounds: whose corner the camera visits. */
  cornerShot?: Side | null;
}

/** Where a boxer sits between rounds (the stool goes right under him). */
export const SEAT: Record<Side, Vec2> = { a: { x: 2.38, z: 2.38 }, b: { x: -2.38, z: -2.38 } };

// ---------------------------------------------------------------- small math
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const smooth = (t: number) => {
  const k = clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};
const mix = (a: Vec2, b: Vec2, k: number): Vec2 => ({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
const len = (v: Vec2) => Math.hypot(v.x, v.z);
/** Yaw so a model facing +Z looks along `dir`. */
export const yawOf = (dir: Vec2) => Math.atan2(dir.x, dir.z);
const lerpAngle = (a: number, b: number, k: number) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
};
const other = (s: Side): Side => (s === "a" ? "b" : "a");

// ---------------------------------------------------------------- per-exchange caches
export interface Window { action: Action; start: number; end: number }

/** One thrown punch paired with the outcome the log actually recorded for it. */
export interface ThrowInfo {
  /** Fight time of the throw event. */
  T: number;
  /** Fight time of the land / block / slip / miss. Extension peaks here. */
  peak: number;
  attacker: Side;
  punch: Punch;
  hand: "lead" | "rear";
  outcome: "land" | "block" | "slip" | "miss";
  target: "head" | "body";
  damage: number;
}

interface HitInfo {
  T: number;
  damage: number;
  target: "head" | "body";
  punch: Punch;
  hand: "lead" | "rear";
  attacker: Side;
}

interface SlipInfo {
  T: number;
  punch: Punch;
  hand: "lead" | "rear";
  attacker: Side;
}

interface SegInfo {
  windows: Record<Side, Window[]>;
  throws: Record<Side, ThrowInfo[]>;
  hits: Record<Side, HitInfo[]>; // hits TAKEN by side
  slips: Record<Side, SlipInfo[]>;
  blocks: Record<Side, SlipInfo[]>;
  clinches: { start: number; end: number }[];
}
const cache = new WeakMap<Segment, SegInfo>();

function pairThrows(ev: TimedEvent[]): ThrowInfo[] {
  const used = new Set<number>();
  const paired: ThrowInfo[] = [];
  ev.forEach((item) => {
    if (item.e.type !== "throw") return;
    const th = item.e;
    let best = -1;
    let bestT = Infinity;
    ev.forEach((cand, j) => {
      if (used.has(j)) return;
      const dt = cand.T - item.T;
      if (dt <= 0 || dt > 0.45 || cand.T >= bestT) return;
      const o = cand.e;
      const matches =
        ((o.type === "land" || o.type === "miss") && o.side === th.side && o.punch === th.punch) ||
        ((o.type === "block" || o.type === "slip") && o.side !== th.side && o.punch === th.punch);
      if (!matches) return;
      best = j;
      bestT = cand.T;
    });
    if (best < 0) return; // smothered, or cut off before it landed: nothing to extend to
    used.add(best);
    const o = ev[best]!.e;
    if (o.type !== "land" && o.type !== "block" && o.type !== "slip" && o.type !== "miss") return;
    paired.push({
      T: item.T,
      peak: ev[best]!.T,
      attacker: th.side,
      punch: th.punch,
      hand: th.hand,
      outcome: o.type,
      target: o.type === "land" ? o.target : th.punch === "body" ? "body" : "head",
      damage: o.type === "land" ? o.damage : 0,
    });
  });
  return paired;
}

export function segInfo(seg: Segment): SegInfo {
  let info = cache.get(seg);
  if (info) return info;
  info = { windows: { a: [], b: [] }, throws: { a: [], b: [] }, hits: { a: [], b: [] }, slips: { a: [], b: [] }, blocks: { a: [], b: [] }, clinches: [] };
  if (seg.kind === "exchange") {
    const ev = seg.events;
    for (const { T, e } of ev) {
      if (e.type === "action-start") info.windows[e.side].push({ action: e.action, start: T, end: T + e.duration });
      if (e.type === "clinch") {
        const brk = ev.find((x) => x.T > T && x.e.type === "break");
        info.clinches.push({ start: T, end: brk ? brk.T : seg.start + seg.duration });
      }
    }
    for (const th of pairThrows(ev)) {
      info.throws[th.attacker].push(th);
      const touch = { T: th.peak, punch: th.punch, hand: th.hand, attacker: th.attacker };
      if (th.outcome === "land") {
        info.hits[other(th.attacker)].push({ ...touch, damage: th.damage, target: th.target });
      } else if (th.outcome === "slip") info.slips[other(th.attacker)].push(touch);
      else if (th.outcome === "block") info.blocks[other(th.attacker)].push(touch);
    }
  }
  cache.set(seg, info);
  return info;
}

/** Paired punches for tests and the pose. Empty outside an exchange. */
export function throwsIn(seg: Segment): ThrowInfo[] {
  const info = segInfo(seg);
  return [...info.throws.a, ...info.throws.b];
}

export function actionAt(seg: Segment, side: Side, T: number): Action | null {
  if (seg.kind !== "exchange") return null;
  const w = segInfo(seg).windows[side].find((x) => T >= x.start && T < x.end);
  return w ? w.action : null;
}

export function clinchedAt(seg: Segment, T: number): boolean {
  return seg.kind === "exchange" && segInfo(seg).clinches.some((c) => T >= c.start - 0.3 && T <= c.end + 0.2);
}

// ---------------------------------------------------------------- knockdown episodes
export interface Episode { side: Side; start: number; end: number; up: number | null; segment: number }

const episodeCache = new WeakMap<Timeline, Episode[]>();
export function episodes(tl: Timeline): Episode[] {
  let eps = episodeCache.get(tl);
  if (eps) return eps;
  eps = tl.knockdowns.map((kd) => {
    const seg = tl.segments[kd.segment] as Segment & { kind: "exchange" };
    const after = seg.events.filter((x) => x.T > kd.T);
    const up = after.find((x) => x.e.type === "get-up" && x.e.side === kd.side);
    const out = after.find((x) => (x.e.type === "counted-out" && x.e.side === kd.side) || x.e.type === "stoppage");
    const stays = out && (!up || out.T < up.T);
    return { side: kd.side, start: kd.T, up: stays ? null : up ? up.T : null, end: stays ? Infinity : up ? up.T + 2.2 : kd.T + 3, segment: kd.segment };
  });
  episodeCache.set(tl, eps);
  return eps;
}

/**
 * Playback rate at fight time T. Knockdowns halve it; a hard land dips it for a fraction of a second.
 * This only scales how fast T advances. Event times stay where the log put them.
 */
export function rateFactorAt(tl: Timeline, T: number): number {
  const knockdown = episodes(tl).some((e) => T >= e.start - 0.6 && T <= Math.min(e.end, e.start + 14) + 0.5) ? 0.5 : 1;
  return Math.min(knockdown, hardLandRate(segmentAt(tl, T), T));
}

// ---------------------------------------------------------------- fight positions
function rawDistance(tl: Timeline, T: number): number {
  const seg = segmentAt(tl, T);
  if (seg.kind !== "exchange") return 1.15;
  if (clinchedAt(seg, T)) return 0.62;
  const a = actionAt(seg, "a", T);
  const b = actionAt(seg, "b", T);
  let d = 1.18;
  if (a === "move") d += 0.4;
  if (b === "move") d += 0.4;
  const info = segInfo(seg);
  for (const s of ["a", "b"] as const) if (info.throws[s].some((x) => T >= x.T - 0.2 && T <= x.T + 0.45)) d -= 0.12;
  return d;
}

function distanceAt(tl: Timeline, T: number): number {
  let sum = 0;
  for (let k = -2; k <= 2; k++) sum += rawDistance(tl, T + k * 0.35);
  return sum / 5;
}

/** Both boxers in the open ring: a slowly drifting centre and axis, distance from what they're doing. */
export function fightSpots(tl: Timeline, T: number): { a: Vec2; b: Vec2; axis: Vec2; mid: Vec2 } {
  const mid = { x: 1.0 * Math.sin(0.043 * T) + 0.25 * Math.sin(0.13 * T), z: 0.85 * Math.sin(0.031 * T + 1.3) };
  const ang = 0.7 * Math.sin(0.019 * T) + 0.3 * Math.sin(0.061 * T);
  const axis = { x: Math.cos(ang), z: Math.sin(ang) };
  const d = distanceAt(tl, T);
  const a = { x: mid.x - (axis.x * d) / 2, z: mid.z - (axis.z * d) / 2 };
  const b = { x: mid.x + (axis.x * d) / 2, z: mid.z + (axis.z * d) / 2 };
  return { a: keepIn(a), b: keepIn(b), axis, mid };
}

const keepIn = (p: Vec2): Vec2 => ({ x: clamp(p.x, -RING_HALF, RING_HALF), z: clamp(p.z, -RING_HALF, RING_HALF) });

function facing(from: Vec2, to: Vec2): number {
  return yawOf(sub(to, from));
}

/** Walk from `from` to `to` over [t0, t1]; returns position, yaw and whether walking. */
function walk(from: Vec2, to: Vec2, t0: number, t1: number, T: number, endYaw: number) {
  const k = smooth((T - t0) / (t1 - t0));
  const pos = mix(from, to, k);
  const moving = T > t0 && T < t1 && len(sub(to, from)) > 0.15;
  const dirYaw = len(sub(to, from)) > 0.01 ? yawOf(sub(to, from)) : endYaw;
  const yaw = moving ? lerpAngle(dirYaw, endYaw, smooth((T - (t1 - 0.6)) / 0.6)) : k >= 1 ? endYaw : dirYaw;
  return { pos, yaw, moving };
}

// ---------------------------------------------------------------- the layout
export function layoutAt(tl: Timeline, T: number): Layout {
  const seg = segmentAt(tl, T);
  const local = T - seg.start;
  const pose = (pos: Vec2, yaw: number, mode: Mode = "fight", modeTime = 0, raised = false): BoxerPose => ({ pos, yaw, mode, modeTime, raised });

  if (seg.kind === "intro") {
    const f = fightSpots(tl, seg.start + seg.duration);
    const wa = walk(CORNER.a, f.a, 1.5, 5.5, local, facing(f.a, f.b));
    const wb = walk(CORNER.b, f.b, 1.5, 5.5, local, facing(f.b, f.a));
    const refSpot = refWatchSpot(f.mid, f.axis);
    return {
      a: pose(wa.pos, local < 1.5 ? facing(CORNER.a, { x: 0, z: 0 }) : wa.yaw, wa.moving ? "walk" : "fight"),
      b: pose(wb.pos, local < 1.5 ? facing(CORNER.b, { x: 0, z: 0 }) : wb.yaw, wb.moving ? "walk" : "fight"),
      ref: { ...walkRef({ x: 0, z: 0.3 }, refSpot, 4, 7, local, f.mid), raise: null },
      focus: { x: 0, z: 0 },
      knockdownSide: null,
    };
  }

  if (seg.kind === "break") {
    const from = fightSpots(tl, seg.start);
    const to = fightSpots(tl, seg.start + seg.duration);
    const out: Partial<Record<Side, BoxerPose>> = {};
    for (const s of ["a", "b"] as const) {
      const seatYaw = facing(CORNER[s], { x: 0, z: 0 });
      const seat = SEAT[s];
      if (local < 3.5) {
        const w = walk(from[s], seat, 0, 3.2, local, seatYaw + Math.PI);
        out[s] = pose(w.pos, local > 3.2 ? seatYaw : w.yaw, w.moving ? "walk" : "stand");
      } else if (local < 9.5) out[s] = pose(seat, seatYaw, "sit", local - 3.5);
      else {
        const w = walk(seat, to[s], 9.7, 11.8, local, facing(to[s], to[other(s)]));
        out[s] = pose(w.pos, w.moving ? w.yaw : local < 9.7 ? seatYaw : w.yaw, w.moving ? "walk" : "stand");
      }
    }
    return {
      a: out.a as BoxerPose,
      b: out.b as BoxerPose,
      ref: { pos: { x: 2.2, z: -2.2 }, yaw: facing({ x: 2.2, z: -2.2 }, { x: 0, z: 0 }), action: "watch", phase: 0, raise: null },
      focus: local >= 3.5 && local < 6.5 ? SEAT.a : local >= 6.5 && local < 9.5 ? SEAT.b : { x: 0, z: 0 },
      knockdownSide: null,
      cornerShot: local >= 3.5 && local < 6.5 ? "a" : local >= 6.5 && local < 9.5 ? "b" : null,
    };
  }

  if (seg.kind === "result") return resultLayout(tl, seg, T);
  return exchangeLayout(tl, seg, T);
}

function refWatchSpot(mid: Vec2, axis: Vec2): Vec2 {
  // Off to the side of the action, on the side nearer the ring centre so he stays inside the ropes.
  const perp = { x: -axis.z, z: axis.x };
  const sign = perp.x * -mid.x + perp.z * -mid.z >= 0 ? 1 : -1;
  return keepIn({ x: mid.x + perp.x * 1.9 * sign, z: mid.z + perp.z * 1.9 * sign });
}

function walkRef(from: Vec2, to: Vec2, t0: number, t1: number, T: number, look: Vec2): Omit<RefPose, "raise"> {
  const w = walk(from, to, t0, t1, T, facing(to, look));
  return { pos: w.pos, yaw: w.moving ? w.yaw : facing(w.pos, look), action: w.moving ? "walk" : "watch", phase: 0 };
}

function exchangeLayout(tl: Timeline, seg: Segment, T: number): Layout {
  const f = fightSpots(tl, T);
  const pos: Record<Side, Vec2> = { a: f.a, b: f.b };
  const yaw: Record<Side, number> = { a: facing(f.a, f.b), b: facing(f.b, f.a) };
  const mode: Record<Side, Mode> = { a: "fight", b: "fight" };
  const modeTime: Record<Side, number> = { a: 0, b: 0 };
  let ref: RefPose = { pos: refWatchSpot(f.mid, f.axis), yaw: 0, action: "watch", phase: 0, raise: null };
  ref.yaw = facing(ref.pos, f.mid);
  let focus = f.mid;
  let knockdownSide: Side | null = null;

  // Referee breaks clinches.
  const info = segInfo(seg);
  const clinch = info.clinches.find((c) => T >= c.end - 1.2 && T <= c.end + 0.8);
  if (clinch) {
    const k = smooth((T - (clinch.end - 1.2)) / 0.7) * (1 - smooth((T - clinch.end) / 0.8));
    ref.pos = mix(ref.pos, { x: f.mid.x + -f.axis.z * 0.45, z: f.mid.z + f.axis.x * 0.45 }, k);
    ref.yaw = facing(ref.pos, f.mid);
    ref.action = k > 0.5 ? "break" : "watch";
  }

  for (const ep of episodes(tl)) {
    if (T < ep.start || T > ep.end + 1.6) continue;
    const s = ep.side;
    const o = other(s);
    knockdownSide = T <= (ep.up ?? Infinity) ? s : null;
    const at = fightSpots(tl, ep.start);
    const downPos = at[s];
    const back = ep.end === Infinity ? 0 : smooth((T - ep.end) / 1.6); // return to the fight
    // The downed boxer
    pos[s] = mix(downPos, f[s], back);
    yaw[s] = lerpAngle(facing(at[s], at[o]), yaw[s], back);
    if (ep.up === null || T < ep.up) {
      mode[s] = "down";
      modeTime[s] = T - ep.start;
    } else if (T < ep.up + 2.2) {
      mode[s] = "rising";
      modeTime[s] = T - ep.up;
    }
    // The other one goes to a neutral corner
    const neutral = NEUTRALS.reduce((best, n) => (len(sub(n, downPos)) > len(sub(best, downPos)) ? n : best));
    const away = smooth((T - ep.start - 0.6) / 2.2) * (1 - back);
    pos[o] = mix(f[o], neutral, away);
    yaw[o] = away > 0.05 && away < 0.95 ? lerpAngle(yaw[o], facing(f[o], neutral), 0.7) : away >= 0.95 ? facing(neutral, downPos) : yaw[o];
    if (away > 0.05 && away < 0.95) mode[o] = "walk";
    // The referee counts over the downed boxer
    const countSpot = keepIn({ x: downPos.x + (neutral.x - downPos.x) * 0.25, z: downPos.z + (neutral.z - downPos.z) * 0.25 });
    const refIn = smooth((T - ep.start - 0.3) / 1.0) * (1 - back);
    ref.pos = mix(ref.pos, countSpot, refIn);
    ref.yaw = facing(ref.pos, downPos);
    const seg2 = tl.segments[ep.segment] as Segment & { kind: "exchange" };
    const counts = seg2.events.filter((x) => x.e.type === "count" && x.e.side === s && x.T <= T);
    const lastCount = counts.at(-1);
    const stop = seg2.events.find((x) => (x.e.type === "stoppage" || x.e.type === "counted-out") && x.T <= T && x.T >= ep.start);
    if (stop) {
      ref.action = "wave";
      ref.phase = T - stop.T;
    } else if (lastCount && T - lastCount.T < 1) {
      ref.action = "count";
      ref.phase = T - lastCount.T;
    } else if (refIn > 0.5) ref.action = "count";
    focus = downPos;
  }
  return {
    a: { pos: pos.a, yaw: yaw.a, mode: mode.a, modeTime: modeTime.a, raised: false },
    b: { pos: pos.b, yaw: yaw.b, mode: mode.b, modeTime: modeTime.b, raised: false },
    ref,
    focus,
    knockdownSide,
  };
}

function resultLayout(tl: Timeline, seg: Segment, T: number): Layout {
  const local = T - seg.start;
  const r = tl.log.result;
  const prev = tl.segments[seg.index - 1];
  const prevT = seg.start - 0.001;
  const before = prev ? layoutAt(tl, prevT) : null;
  const downSide = before && before.knockdownSide ? before.knockdownSide : null;
  const centre: Record<Side, Vec2> = { a: { x: -0.7, z: 0.2 }, b: { x: 0.7, z: 0.2 } };
  const front = yawOf({ x: 0, z: 1 });
  const out: Partial<Record<Side, BoxerPose>> = {};
  for (const s of ["a", "b"] as const) {
    const start = before ? before[s].pos : centre[s];
    if (s === downSide) {
      out[s] = { pos: start, yaw: before ? before[s].yaw : front, mode: "down", modeTime: 10 + local, raised: false };
      continue;
    }
    const target = downSide ? { x: 0.75, z: 0.2 } : centre[s];
    const w = walk(start, target, 1, 4.5, local, front);
    const winner = r.winner === s || r.winner === null;
    const raised = winner && local > 6.5;
    const loser = r.winner !== null && r.winner !== s;
    const mode: Mode = w.moving ? "walk" : local > 10 && r.winner === s ? "victory" : loser && local > 6.5 ? "defeated" : "stand";
    out[s] = { pos: w.pos, yaw: w.moving ? w.yaw : front, mode, modeTime: mode === "defeated" ? local - 6.5 : local - 10, raised };
  }
  const refTarget = downSide ? { x: 0.05, z: 0.2 } : { x: 0, z: 0.2 };
  const rw = walkRef(before ? before.ref.pos : { x: 0, z: 0.5 }, refTarget, 0.5, 4.5, local, { x: 0, z: 5 });
  const raise: RefPose["raise"] = local > 6.5 ? (r.winner ?? "both") : null;
  return {
    a: out.a as BoxerPose,
    b: out.b as BoxerPose,
    ref: { ...rw, yaw: rw.action === "walk" ? rw.yaw : front, action: raise ? "raise" : rw.action, phase: local - 6.5, raise },
    focus: { x: 0, z: 0.2 },
    knockdownSide: downSide,
  };
}

// ---------------------------------------------------------------- what the arms are doing
export interface ArmActivity {
  punch: (ThrowInfo & { ext: number }) | null;
  hit: { amount: number; k: number; target: "head" | "body"; punch: Punch; hand: "lead" | "rear"; attacker: Side } | null;
  slip: { amount: number; punch: Punch; hand: "lead" | "rear"; attacker: Side } | null;
  /** Gloves held in the guard, either because that is the action or a block just happened. */
  guarding: boolean;
  recoil: { amount: number; punch: Punch; hand: "lead" | "rear"; attacker: Side } | null;
  moving: boolean;
  clinch: boolean;
  bob: number;
}

/** Extension 0..1. Peaks at `peak`, the outcome time taken from the log. */
export function punchExtension(T: number, throwT: number, peak: number): number {
  return extensionAt(T, throwT, peak);
}

export function activityAt(tl: Timeline, side: Side, T: number): ArmActivity {
  const seg = segmentAt(tl, T);
  const act: ArmActivity = {
    punch: null,
    hit: null,
    slip: null,
    guarding: false,
    recoil: null,
    moving: false,
    clinch: false,
    bob: Math.sin(T * 2.3 + (side === "a" ? 0 : 1.7)),
  };
  if (seg.kind !== "exchange") return act;
  const info = segInfo(seg);
  const current = actionAt(seg, side, T);
  act.moving = current === "move";
  act.clinch = clinchedAt(seg, T);
  act.guarding = current === "block" || info.blocks[side].some((b) => Math.abs(T - b.T) < 0.45);
  for (const th of info.throws[side]) {
    const ext = extensionAt(T, th.T, th.peak);
    if (ext > 0 && (!act.punch || ext > act.punch.ext)) act.punch = { ...th, ext };
  }
  for (const h of info.hits[side]) {
    const k = landEnvelope(T - h.T);
    if (k > 0 && (!act.hit || k * h.damage > act.hit.k * act.hit.amount)) {
      act.hit = { amount: h.damage, k, target: h.target, punch: h.punch, hand: h.hand, attacker: h.attacker };
    }
  }
  for (const s of info.slips[side]) {
    const amount = slipEnvelope(T - s.T);
    if (amount > (act.slip?.amount ?? 0)) act.slip = { amount, punch: s.punch, hand: s.hand, attacker: s.attacker };
  }
  for (const b of info.blocks[side]) {
    const amount = recoilEnvelope(T - b.T);
    // Amount is 0 at the logged block itself, which is when the gloves have to be touching.
    const meeting = Math.abs(T - b.T) <= 0.02;
    if (meeting || amount > (act.recoil?.amount ?? -1)) act.recoil = { amount, punch: b.punch, hand: b.hand, attacker: b.attacker };
  }
  return act;
}
