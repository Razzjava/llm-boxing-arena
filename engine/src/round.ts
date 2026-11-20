// Between rounds: scoring, cutman, doctor, recovery, reset the round counters.
import type { FightEvent, FightState, Side } from "./types.js";
import type { Rng } from "./rng.js";
import { CUTS, RECOVERY, ROUNDS, STAMINA } from "./tuning.js";
import { clone, emptyRoundStats, other } from "./state.js";
import { decide, scoreRound } from "./judging.js";
import { treatCuts, worstCut } from "./cuts.js";
import { end } from "./knockdown.js";
import { gainStamina } from "./stats.js";

const TECHNICAL_DECISION_FROM_ROUND = 4;

/** Call after the 6th exchange of a round (if the fight is still on). */
export function endRound(state: FightState, rng: Rng): { state: FightState; events: FightEvent[] } {
  const s = clone(state);
  const events: FightEvent[] = [];
  if (s.result) return { state: s, events };

  events.push({ t: 0, type: "round-end", round: s.round });
  const cards = scoreRound(s, rng);
  events.push({ t: 1, type: "round-scored", round: s.round, cards });

  if (s.round >= ROUNDS) {
    const d = decide(s.scorecards);
    end(s, d.winner, d.method, 30, d.reason);
    return { state: s, events };
  }

  for (const side of ["a", "b"] as const) {
    treatCuts(s[side], side, 5, rng, events);
    doctorCheck(s, side, rng, events);
    if (s.result) return { state: s, events };
  }

  for (const side of ["a", "b"] as const) {
    const b = s[side];
    gainStamina(b, b.maxStamina * (STAMINA.roundRecoveryBase + STAMINA.roundRecoveryPerStat * b.build.stats.stamina));
    b.headHealth = Math.min(100, b.headHealth + RECOVERY.headPerRound);
    b.bodyHealth = Math.min(100, b.bodyHealth + RECOVERY.bodyPerRound);
    b.hurt = false;
    b.knockdownsRound = 0;
    b.clinchesRound = 0;
    b.deductionsRound = 0;
  }
  s.roundStats = { a: emptyRoundStats(), b: emptyRoundStats() };
  s.round += 1;
  s.exchange = 1;
  return { state: s, events };
}

function doctorCheck(s: FightState, side: Side, rng: Rng, events: FightEvent[]): void {
  const cut = worstCut(s[side]);
  if (!cut || cut.severity < 4) return;
  const stop = rng.chance(CUTS.doctorStopChance[cut.severity] ?? 0);
  events.push({ t: 10, type: "doctor-check", side, location: cut.location, severity: cut.severity, allowed: !stop });
  if (!stop) return;
  events.push({ t: 12, type: "stoppage", side, by: "doctor", reason: `bad cut over the ${cut.location}` });
  if (cut.cause === "punch") {
    end(s, other(side), "TKO", 30, `doctor stopped it: cut over the ${cut.location}`);
    return;
  }
  // Cut from an accidental head clash: go to the cards, or a technical draw if it's too early.
  if (s.round < TECHNICAL_DECISION_FROM_ROUND) {
    end(s, null, "TD", 30, `technical draw: accidental clash cut over the ${cut.location} before round ${TECHNICAL_DECISION_FROM_ROUND}`);
    return;
  }
  const d = decide(s.scorecards);
  end(s, d.winner, "TD", 30, `technical decision after an accidental clash cut: ${d.reason}`);
}
