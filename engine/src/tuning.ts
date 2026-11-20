// Every balance number lives here so tuning never means hunting through logic.
import type { Punch, Tactic } from "./types.js";

export const ROUNDS = 10;
export const EXCHANGES_PER_ROUND = 6;
export const EXCHANGE_SECONDS = 30;

export interface PunchSpec {
  /** Punches thrown when this action is chosen (one action = a short volley). */
  volley: number;
  baseLand: number;
  damage: number;
  stamina: number;
  target: "head" | "body";
  hand: "lead" | "rear";
  straight: boolean; // slips work well against straights
  power: boolean; // counts as a power punch for judges and knockdowns
}

export const PUNCHES: Record<Punch, PunchSpec> = {
  jab: { volley: 4, baseLand: 0.4, damage: 0.45, stamina: 0.5, target: "head", hand: "lead", straight: true, power: false },
  cross: { volley: 3, baseLand: 0.34, damage: 0.9, stamina: 1.0, target: "head", hand: "rear", straight: true, power: true },
  hook: { volley: 2, baseLand: 0.3, damage: 1.1, stamina: 1.3, target: "head", hand: "lead", straight: false, power: true },
  uppercut: { volley: 1, baseLand: 0.27, damage: 1.35, stamina: 1.6, target: "head", hand: "rear", straight: false, power: true },
  body: { volley: 2, baseLand: 0.38, damage: 1.0, stamina: 1.1, target: "body", hand: "rear", straight: false, power: true },
};

export const LAND = {
  perAccuracyVsDefence: 0.03, // per point of (accuracy - defence)
  perSpeed: 0.01, // per point of speed difference
  bothPunchingBonus: 0.05, // defender is busy throwing, so easier to hit
  moveMalus: 0.12,
  outBoxerMoveExtra: 0.04,
  pressureCutsOffRing: 0.5, // pressure fighters halve the benefit of moving away
  swarmerCutsOffRing: 0.5, // swarmers on pressure cut it off further
  hurtDefenderBonus: 0.08,
  min: 0.05,
  max: 0.85,
};

export const DEFEND = {
  blockBase: 0.4,
  blockPerDefence: 0.04,
  blockVsUppercut: 0.5, // uppercuts split the guard: block chance multiplied by this
  blockedDamage: 0.2, // fraction of damage that still gets through a block
  slipStraightBase: 0.3,
  slipStraightPerDefence: 0.04,
  slipCurvedBase: 0.08,
  slipCurvedPerDefence: 0.015,
  slippedIntoMultiplier: 1.25, // failed slip into a hook/uppercut hurts more
  counterLandBonus: 0.15,
  counterPuncherBonus: 0.06,
  counterPuncherDamage: 1.1,
};

export const STAMINA = {
  baseMax: 60,
  perStat: 6,
  blockCost: 0.4, // per punch blocked
  slipCost: 1.0, // per slip window
  moveCost: 1.0, // per move window
  clinchGain: 2.0,
  exchangeRecoveryBase: 1.2,
  exchangeRecoveryPerStat: 0.25,
  roundRecoveryBase: 0.12, // fraction of max
  roundRecoveryPerStat: 0.022,
  bodyDrainPerDamage: 1.9, // stamina lost per point of body damage
  lowBodyCostMultiplier: 1.3, // costs when body health < 50
  fatigueStartsAt: 0.5, // stamina fraction below which stats weaken
  fatigueFloor: 0.5, // multiplier at zero stamina
};

export const TACTIC: Record<Tactic, { land: number; damage: number; cost: number; defence: number }> = {
  pressure: { land: 0.03, damage: 1.1, cost: 1.25, defence: -0.5 },
  box: { land: 0, damage: 1, cost: 1, defence: 0 },
  survive: { land: -0.03, damage: 0.85, cost: 0.8, defence: 1 },
};

export const DAMAGE = {
  powerBase: 0.6,
  powerPerStat: 0.08,
  sluggerPowerPunch: 1.1,
  swarmerBody: 1.1,
  variance: 0.25, // +/- fraction
};

export const HURT = {
  /** A head shot dealing this fraction of the chin threshold leaves the boxer hurt. */
  fraction: 0.85,
  defenceMalus: 2,
  speedMalus: 1,
};

export const KNOCKDOWN = {
  chinBase: 1.6,
  chinPerStat: 0.18,
  damageTakenWeight: 1.5, // shock multiplied by (1 + weight * missing head health / 100)
  hurtMultiplier: 1.3,
  sluggerShock: 1.1,
  baseChance: 0.05,
  overThresholdWeight: 0.3,
  maxChance: 0.85,
  // Get-up roll
  getUpBase: 0.55,
  getUpPerChin: 0.04,
  getUpStamina: 0.2,
  getUpHealth: 0.3,
  getUpPerPriorKnockdown: -0.08,
  getUpPerRoundKnockdown: -0.1,
  getUpZeroHealth: -0.3,
  getUpMin: 0.05,
  getUpMax: 0.97,
  recoverHealthOnGetUp: 5,
  knockdownsForTko: 3,
};

export const REFEREE = {
  // Was 12 / 0.6. A slightly quicker wave-off replaces the stoppages that
  // used to land in rounds 11 and 12, without ending the early rounds.
  stopAfterGetUpHealth: 16,
  stopAfterGetUpChance: 0.75,
  oneSidedDamage: 5, // head damage in one exchange
  oneSidedHealth: 25,
  oneSidedChance: 0.5,
  clinchWarningAt: 3,
  clinchDeductionAt: 5,
};

export const CUTS = {
  openChancePerDamage: 0.01, // per point of hook/uppercut damage
  openChanceOther: 0.003, // per point of damage, other head punches
  worsenChance: 0.04, // per landed head punch, per open cut
  headClashChance: 0.003,
  mixedStanceClashMultiplier: 2,
  clashCutChance: 0.3,
  maxSeverity: 5,
  cutmanFixChance: 0.5,
  doctorStopChance: { 4: 0.1, 5: 0.6 } as Record<number, number>,
  bleedAccuracyMalus: 0.5, // per eye cut of severity >= 3
};

export const RECOVERY = {
  // A 10-round bout has less time for damage to pile up. A little less healing
  // between rounds (was 4 head / 3 body) keeps stoppages in the middle rounds
  // instead of almost every fight going to the cards.
  headPerRound: 3,
  bodyPerRound: 2,
};

export const JUDGING = {
  landedWeight: 1,
  powerWeight: 0.6,
  damageWeight: 1.0,
  aggressionThrownWeight: 0.12,
  cleanAccuracyWeight: 8, // times accuracy fraction
  cleanPowerWeight: 0.5,
  defenceAvoidedWeight: 0.3,
  noise: 1.5,
  tieBand: 0.75, // score difference below this is an even round (10-10)
  dominantRatio: 2.2,
  dominantMargin: 12,
  minRoundScore: 6,
};
