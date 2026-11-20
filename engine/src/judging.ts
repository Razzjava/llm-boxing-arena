// Three judges, each with a small bias, scoring every round on the 10-point must system.
import type { FightState, JudgeBias, RoundStats, Scorecard, Side, EndMethod } from "./types.js";
import type { Rng } from "./rng.js";
import { JUDGING } from "./tuning.js";

export const JUDGES: { judge: string; bias: JudgeBias }[] = [
  { judge: "Judge Ortiz", bias: "aggression" },
  { judge: "Judge Lambert", bias: "clean punching" },
  { judge: "Judge Okafor", bias: "defence" },
];

export function newScorecards(): Scorecard[] {
  return JUDGES.map((j) => ({ ...j, rounds: [], totalA: 0, totalB: 0 }));
}

/** How impressive a boxer's round looked to a judge with this bias. */
export function impression(mine: RoundStats, bias: JudgeBias): number {
  let score = JUDGING.landedWeight * mine.landed + JUDGING.powerWeight * mine.powerLanded + JUDGING.damageWeight * mine.damage;
  if (bias === "aggression") score += JUDGING.aggressionThrownWeight * mine.thrown;
  if (bias === "clean punching") {
    const accuracy = mine.thrown > 0 ? mine.landed / mine.thrown : 0;
    score += JUDGING.cleanAccuracyWeight * accuracy + JUDGING.cleanPowerWeight * mine.powerLanded;
  }
  if (bias === "defence") score += JUDGING.defenceAvoidedWeight * (mine.blocked + mine.slipped);
  return score;
}

/**
 * One judge's card for one round.
 * Winner on impression gets 10, loser 9 (8 if dominated). Each knockdown suffered costs a point.
 * Point deductions come off after that.
 */
export function scoreRoundForJudge(s: FightState, bias: JudgeBias, rng: Rng): { a: number; b: number } {
  const ia = impression(s.roundStats.a, bias) + rng.range(-JUDGING.noise, JUDGING.noise);
  const ib = impression(s.roundStats.b, bias) + rng.range(-JUDGING.noise, JUDGING.noise);
  let a = 10;
  let b = 10;
  if (Math.abs(ia - ib) >= JUDGING.tieBand) {
    const aWon = ia > ib;
    const hi = Math.max(ia, ib);
    const lo = Math.max(0.1, Math.min(ia, ib));
    // "Dominant" 10-8s only for rounds without knockdowns; knockdowns score themselves.
    const noKnockdowns = s.a.knockdownsRound === 0 && s.b.knockdownsRound === 0;
    const dominant = noKnockdowns && hi / lo >= JUDGING.dominantRatio && hi - lo >= JUDGING.dominantMargin;
    const loserScore = dominant ? 8 : 9;
    if (aWon) b = loserScore;
    else a = loserScore;
  }
  a -= s.a.knockdownsRound;
  b -= s.b.knockdownsRound;
  const top = Math.max(a, b);
  a += 10 - top;
  b += 10 - top;
  // Level after knockdowns: the boxer who scored more knockdowns takes the round.
  if (a === b && s.a.knockdownsRound !== s.b.knockdownsRound) {
    if (s.a.knockdownsRound > s.b.knockdownsRound) a -= 1;
    else b -= 1;
  }
  a = Math.max(7, a); // 10-7 is the widest round the judges give
  b = Math.max(7, b);
  a = Math.max(JUDGING.minRoundScore, a - s.a.deductionsRound);
  b = Math.max(JUDGING.minRoundScore, b - s.b.deductionsRound);
  return { a, b };
}

/** Adds this round to every judge's card. Mutates the cards in `s`. */
export function scoreRound(s: FightState, rng: Rng): { judge: string; a: number; b: number }[] {
  return s.scorecards.map((card) => {
    const { a, b } = scoreRoundForJudge(s, card.bias, rng);
    card.rounds.push({ round: s.round, a, b });
    card.totalA += a;
    card.totalB += b;
    return { judge: card.judge, a, b };
  });
}

/** Decision from the cards: UD, SD, MD or draw. */
export function decide(cards: Scorecard[]): { winner: Side | null; method: EndMethod; reason: string } {
  let forA = 0;
  let forB = 0;
  for (const c of cards) {
    if (c.totalA > c.totalB) forA++;
    else if (c.totalB > c.totalA) forB++;
  }
  const even = cards.length - forA - forB;
  const tally = cards.map((c) => `${Math.max(c.totalA, c.totalB)}-${Math.min(c.totalA, c.totalB)}`).join(", ");
  if (forA === 3 || forB === 3) return { winner: forA === 3 ? "a" : "b", method: "UD", reason: `unanimous decision (${tally})` };
  if ((forA === 2 && forB === 1) || (forB === 2 && forA === 1)) return { winner: forA === 2 ? "a" : "b", method: "SD", reason: `split decision (${tally})` };
  if ((forA === 2 || forB === 2) && even === 1) return { winner: forA === 2 ? "a" : "b", method: "MD", reason: `majority decision (${tally})` };
  return { winner: null, method: "draw", reason: `draw (${tally})` };
}
