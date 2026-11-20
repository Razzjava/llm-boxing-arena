// Effective stats: the build's numbers after fatigue, being hurt, tactics and cuts.
import type { BoxerState } from "./types.js";
import { CUTS, HURT, STAMINA, TACTIC } from "./tuning.js";

/** 1.0 when fresh; drops linearly to fatigueFloor as stamina runs from 50% to empty. */
export function fatigue(b: BoxerState): number {
  const frac = b.stamina / b.maxStamina;
  if (frac >= STAMINA.fatigueStartsAt) return 1;
  return STAMINA.fatigueFloor + (1 - STAMINA.fatigueFloor) * (frac / STAMINA.fatigueStartsAt);
}

export function effPower(b: BoxerState): number {
  return b.build.stats.power * fatigue(b);
}

export function effSpeed(b: BoxerState): number {
  return b.build.stats.speed * fatigue(b) - (b.hurt ? HURT.speedMalus : 0);
}

export function effDefence(b: BoxerState): number {
  return b.build.stats.defence * fatigue(b) + TACTIC[b.tactic].defence - (b.hurt ? HURT.defenceMalus : 0);
}

export function effAccuracy(b: BoxerState): number {
  const bleedingEyes = b.cuts.filter((c) => c.severity >= 3 && c.location.includes("eyebrow")).length;
  return b.build.stats.accuracy - bleedingEyes * CUTS.bleedAccuracyMalus;
}

export function spendStamina(b: BoxerState, amount: number): void {
  b.stamina = Math.max(0, b.stamina - amount);
}

export function gainStamina(b: BoxerState, amount: number): void {
  b.stamina = Math.min(b.maxStamina, b.stamina + amount);
}
