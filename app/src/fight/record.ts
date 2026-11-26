// This tab's completed fights. Memory only: nothing here is written to storage, and a replay
// must never call recordResult. That keeps a rewatched log from counting as a new bout.
import type { SavedFight } from "./runArenaFight";

export interface ArenaStats {
  fights: number;
  knockouts: number;
}

export interface RecordedResult {
  seed: number;
  red: string;
  blue: string;
  winner: "a" | "b" | null;
  method: string;
  round: number;
  scorecards: { judge: string; totalA: number; totalB: number }[];
}

let history: RecordedResult[] = [];
let stats: ArenaStats = { fights: 0, knockouts: 0 };

/** Note a fight that just finished in this tab. Do not call this for a file replay. */
export function recordResult(fight: SavedFight): void {
  const result = fight.log.result;
  history.push({
    seed: fight.log.seed,
    red: fight.log.builds.a.name,
    blue: fight.log.builds.b.name,
    winner: result.winner,
    method: result.method,
    round: result.round,
    scorecards: result.scorecards.map((card) => ({ judge: card.judge, totalA: card.totalA, totalB: card.totalB })),
  });
  const stoppage = result.method === "KO" || result.method === "TKO";
  stats = { fights: stats.fights + 1, knockouts: stats.knockouts + (stoppage ? 1 : 0) };
}

export function fightHistory(): readonly RecordedResult[] {
  return history.slice();
}

export function arenaStats(): ArenaStats {
  return { ...stats };
}

export function resetArenaRecord(): void {
  history = [];
  stats = { fights: 0, knockouts: 0 };
}
