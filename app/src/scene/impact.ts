// Punch contact, reactions and impact feel. Every value is a function of fight time and the log:
// no randomness, and nothing here reads a frame delta.
import type { Punch, Side } from "@llm-boxing-arena/engine";
import type { Segment } from "../playback/timeline";

export const HARD_LAND = 1.4;
/** Metres between head bones. Two skulls this size no longer occupy the same space. */
export const MIN_HEAD_GAP = 0.38;
/** Metres between abdomen bones. Keeps the chests from merging when someone steps in. */
export const MIN_TORSO_GAP = 0.46;
export const PUNCH_BACK = 0.4;
export const SWEAT_COUNT = 6;

const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

/** 0 at the throw, 1 at the logged outcome, then back to 0. */
export function extensionAt(T: number, throwT: number, peakT: number): number {
  const out = Math.max(0.05, peakT - throwT);
  const t = T - throwT;
  if (t < 0 || t > out + PUNCH_BACK) return 0;
  if (t <= out) return Math.sin((t / out) * (Math.PI / 2));
  return 1 - smooth((t - out) / PUNCH_BACK);
}

/** Head-shot reaction. 0 at the instant of impact so the chin is still there to be hit, then a snap. */
export function landEnvelope(age: number): number {
  if (age < 0 || age > 1.05) return 0;
  const hit = Math.sin(Math.min(1, age / 0.14) * (Math.PI / 2));
  const fade = age <= 0.14 ? 1 : 1 - smooth((age - 0.14) / 0.9);
  return hit * fade;
}

/** Slip peaks at the logged slip, so the head is already off the punch when the glove arrives. */
export function slipEnvelope(age: number): number {
  if (age < -0.18 || age > 0.7) return 0;
  if (age <= 0) return smooth((age + 0.18) / 0.18);
  return 1 - smooth(age / 0.7);
}

/** Block recoil starts at the logged block (gloves still touching) and kicks back just after. */
export function recoilEnvelope(age: number): number {
  if (age < 0 || age > 0.36) return 0;
  if (age <= 0.08) return age / 0.08;
  return 1 - smooth((age - 0.08) / 0.28);
}

/**
 * +1 when the punching hand is on the defender's left.
 * Facing is the two yaws; the sign does not depend on the clock.
 */
export function arrivalSign(attackerYaw: number, defenderYaw: number, handIsRight: boolean): 1 | -1 {
  const attLeftX = Math.cos(attackerYaw);
  const attLeftZ = -Math.sin(attackerYaw);
  const defLeftX = Math.cos(defenderYaw);
  const defLeftZ = -Math.sin(defenderYaw);
  const hx = handIsRight ? -attLeftX : attLeftX;
  const hz = handIsRight ? -attLeftZ : attLeftZ;
  return hx * defLeftX + hz * defLeftZ >= 0 ? 1 : -1;
}

export function punchingHand(lead: "L" | "R", hand: "lead" | "rear"): "L" | "R" {
  if (hand === "lead") return lead;
  return lead === "L" ? "R" : "L";
}

/** How hard a landed punch should read. Light jabs stay small; heavy shots pass 1. */
export function damageWeight(damage: number): number {
  return Math.max(0.4, Math.min(1.25, damage / 1.35));
}

export interface Reaction {
  /** Radians. Positive turns the face toward the defender's left. */
  headYaw: number;
  /** Radians. Positive lifts the chin. */
  headPitch: number;
  /** Radians. Positive tilts the head toward the defender's left. */
  headRoll: number;
  /** Radians. Positive folds the torso forward. */
  torsoFold: number;
  /** 0..1 drop of the guard. */
  handsDrop: number;
  /** 0..1 kick of the blocking glove back toward the face. The head stays still. */
  gloveRecoil: number;
  /** Metres. Positive slips the head toward the defender's left. */
  slip: number;
}

const STILL: Reaction = { headYaw: 0, headPitch: 0, headRoll: 0, torsoFold: 0, handsDrop: 0, gloveRecoil: 0, slip: 0 };

export function reactionFor(input: {
  outcome: "land" | "block" | "slip" | "miss";
  punch: Punch;
  /** +1 when the punching hand is on the defender's left. */
  arrival: 1 | -1;
  damage: number;
  /** 0..1 time shape. Direction does not depend on this, only the size. */
  envelope: number;
}): Reaction {
  if (input.outcome === "miss" || input.envelope <= 0) return { ...STILL };
  const e = input.envelope;
  // Away from the glove: a jab from the left snaps the head right, and the cross (other hand) snaps back.
  const away = (input.arrival === 1 ? -1 : 1) as 1 | -1;
  if (input.outcome === "block") return { ...STILL, gloveRecoil: e };
  if (input.outcome === "slip") {
    return { ...STILL, slip: away * 0.16 * e, headYaw: away * 0.4 * e };
  }
  const w = damageWeight(input.damage) * e;
  switch (input.punch) {
    case "jab":
      return { ...STILL, headYaw: away * 0.22 * w, headPitch: -0.22 * w };
    case "cross":
      return { ...STILL, headYaw: away * 0.55 * w, headPitch: -0.48 * w };
    case "hook":
      // The hook travels from the hand across the face, and the head turns with it.
      return { ...STILL, headYaw: away * 0.78 * w, headRoll: away * 0.18 * w };
    case "uppercut":
      return { ...STILL, headPitch: 0.68 * w, headYaw: away * 0.05 * w };
    case "body":
      return { ...STILL, torsoFold: 0.75 * w, handsDrop: Math.min(1, 0.95 * w) };
    default:
      return { ...STILL };
  }
}

export type ContactKind = "chin" | "body" | "guard" | "air";

export function contactKind(outcome: string, target: "head" | "body"): ContactKind {
  if (outcome === "block") return "guard";
  if (outcome === "slip" || outcome === "miss") return "air";
  return target === "body" ? "body" : "chin";
}

/**
 * Where the glove centre should be, in the defender's frame.
 * +x is the defender's left, +y is up, +z is toward the attacker (the defender's forward).
 */
export function contactOffset(kind: ContactKind, arrival: 1 | -1, target: "head" | "body"): { x: number; y: number; z: number } {
  // z is toward the attacker, so the glove centre sits outside the mesh instead of inside it.
  if (kind === "chin") return { x: 0, y: -0.09, z: 0.22 };
  if (kind === "body") return { x: arrival * 0.04, y: 0.02, z: 0.24 };
  if (kind === "guard") return { x: arrival * 0.08, y: 0.0, z: 0.3 };
  if (target === "body") return { x: arrival * 0.28, y: 0.02, z: 0.16 };
  return { x: arrival * 0.28, y: -0.02, z: 0.1 };
}

/** Clock rate only. 1 most of the time, dipping under 1 for a fraction of a second after a hard land. */
export function hardLandRate(seg: Segment | null, T: number): number {
  if (!seg || seg.kind !== "exchange") return 1;
  let rate = 1;
  for (const { T: t, e } of seg.events) {
    if (e.type !== "land" || e.damage < HARD_LAND) continue;
    const age = T - t;
    if (age < 0 || age > 0.34) continue;
    const hit = Math.sin(Math.min(1, age / 0.07) * (Math.PI / 2));
    const fade = age <= 0.07 ? 1 : 1 - smooth((age - 0.07) / 0.27);
    rate = Math.min(rate, 1 - 0.4 * hit * fade);
  }
  return rate;
}

export interface CameraKick {
  /** Metres, along the line from attacker to defender. */
  forward: number;
  /** Metres, to the attacker's left of that line. */
  lateral: number;
  vertical: number;
  attacker: Side;
}

/** Small shake for a hard land. Zero when nothing hard has just landed. */
export function cameraKick(seg: Segment | null, T: number): CameraKick | null {
  if (!seg || seg.kind !== "exchange") return null;
  let best: CameraKick | null = null;
  for (const { T: t, e } of seg.events) {
    if (e.type !== "land" || e.damage < HARD_LAND) continue;
    const age = T - t;
    if (age < 0 || age > 0.4) continue;
    const fade = Math.exp(-age * 6) * (1 - smooth(age / 0.4));
    const mag = Math.min(1.15, e.damage / 1.5) * fade;
    if (mag < 0.02) continue;
    const kick: CameraKick = {
      forward: 0.28 * mag,
      lateral: 0.1 * mag * Math.sin(Math.min(1, age / 0.16) * Math.PI),
      vertical: 0.08 * mag,
      attacker: e.side,
    };
    if (!best || mag > best.forward) best = kick;
  }
  return best;
}

/** 0..1 white flash on the punching glove, only for a hard land. */
export function flashIntensity(age: number, damage: number): number {
  if (damage < HARD_LAND || age < 0 || age > 0.16) return 0;
  return (1 - age / 0.16) * Math.min(1, damage / 1.8);
}

export interface SweatDrop {
  /** Defender frame: +x left, +y up, +z forward. */
  x: number;
  y: number;
  z: number;
  /** World scale of the drop. */
  s: number;
}

/** A fixed handful of drops. Index picks the direction, age picks the travel. */
export function sweatDrops(age: number, damage: number): SweatDrop[] {
  if (damage < HARD_LAND || age < 0 || age > 0.45) return [];
  const fade = 1 - smooth(age / 0.45);
  const drops: SweatDrop[] = [];
  for (let i = 0; i < SWEAT_COUNT; i++) {
    const ang = (i + 0.5) * 2.399963;
    const spread = 0.35 + (i % 3) * 0.12;
    drops.push({
      x: Math.cos(ang) * age * spread,
      y: 0.05 + age * (0.85 + (i % 4) * 0.18),
      z: Math.sin(ang) * age * spread * 0.65,
      s: 0.018 * fade * (0.75 + (i % 3) * 0.2),
    });
  }
  return drops;
}

/** Most recent hard land whose sweat or flash is still in the air, if any. */
export function hardImpactAt(seg: Segment | null, T: number): { age: number; damage: number; attacker: Side; target: "head" | "body" } | null {
  if (!seg || seg.kind !== "exchange") return null;
  let best: { age: number; damage: number; attacker: Side; target: "head" | "body" } | null = null;
  for (const { T: t, e } of seg.events) {
    if (e.type !== "land" || e.damage < HARD_LAND) continue;
    const age = T - t;
    if (age < 0 || age > 0.45) continue;
    if (!best || e.damage > best.damage) best = { age, damage: e.damage, attacker: e.side, target: e.target };
  }
  return best;
}
