// Download a fight as JSON and load one back. Loading re-runs the engine (replayFight) from the
// logged seed and plans, so the replay is the engine's own result, not just the file's word for it.
import { replayFight, type FightLog } from "@llm-boxing-arena/engine";
import type { SavedFight } from "./runArenaFight";

export function fightFileName(s: SavedFight): string {
  const n = (x: string) => x.replace(/[^\w-]+/g, "-").slice(0, 20);
  return `fight-${n(s.log.builds.a.name)}-vs-${n(s.log.builds.b.name)}-seed${s.log.seed}.json`;
}

export function serializeFight(s: SavedFight): string {
  return JSON.stringify(s, null, 1);
}

export async function loadFight(text: string): Promise<{ fight: SavedFight; identical: boolean }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const obj = parsed as Partial<SavedFight> & Partial<FightLog>;
  // Accept both our wrapper and a bare engine log (e.g. from `npm run demo -- --json=...`).
  const log = (obj.log ?? (obj.version === 1 && obj.rounds ? obj : null)) as FightLog | null;
  if (!log || log.version !== 1 || !Array.isArray(log.rounds) || typeof log.seed !== "number" || !log.builds) {
    throw new Error("That doesn't look like an LLM Boxing Arena fight log.");
  }
  const replayed = await replayFight(log);
  const identical = JSON.stringify(replayed.rounds) === JSON.stringify(log.rounds) && JSON.stringify(replayed.result) === JSON.stringify(log.result);
  const meta = obj.meta ?? { a: { label: "Red corner" }, b: { label: "Blue corner" } };
  return { fight: { app: "llm-boxing-arena", version: 1, meta, log: replayed }, identical };
}
