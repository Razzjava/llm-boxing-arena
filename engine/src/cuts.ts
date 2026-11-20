// Cuts: opening, worsening, the cutman between rounds.
import type { BoxerState, Cut, CutLocation, FightEvent, Punch, Side } from "./types.js";
import type { Rng } from "./rng.js";
import { CUTS } from "./tuning.js";

const LOCATIONS: readonly CutLocation[] = ["left eyebrow", "right eyebrow", "forehead", "nose"];

/** After a landed head punch: maybe worsen existing cuts, maybe open a new one. */
export function cutsFromPunch(
  b: BoxerState, side: Side, punch: Punch, damage: number, t: number, round: number, rng: Rng, events: FightEvent[],
): void {
  for (const cut of b.cuts) {
    if (cut.severity < CUTS.maxSeverity && rng.chance(CUTS.worsenChance)) {
      cut.severity += 1;
      events.push({ t, type: "cut-worsened", side, location: cut.location, severity: cut.severity });
    }
  }
  const rate = punch === "hook" || punch === "uppercut" ? CUTS.openChancePerDamage : CUTS.openChanceOther;
  if (rng.chance(rate * damage)) openCut(b, side, "punch", damage > 1.5 ? 2 : 1, t, round, rng, events);
}

export function openCut(
  b: BoxerState, side: Side, cause: Cut["cause"], severity: number, t: number, round: number, rng: Rng, events: FightEvent[],
): void {
  const free = LOCATIONS.filter((loc) => !b.cuts.some((c) => c.location === loc));
  if (free.length === 0) return;
  const location = rng.pick(free);
  b.cuts.push({ location, severity, cause, openedRound: round });
  events.push({ t, type: "cut-opened", side, location, cause });
}

export function worstCut(b: BoxerState): Cut | null {
  let worst: Cut | null = null;
  for (const c of b.cuts) if (!worst || c.severity > worst.severity) worst = c;
  return worst;
}

/** Cutman works on the worst cut between rounds. */
export function treatCuts(b: BoxerState, side: Side, t: number, rng: Rng, events: FightEvent[]): void {
  const cut = worstCut(b);
  if (cut && cut.severity > 1 && rng.chance(CUTS.cutmanFixChance)) {
    cut.severity -= 1;
    events.push({ t, type: "cut-treated", side, location: cut.location, severity: cut.severity });
  }
}
