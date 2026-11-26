import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_BUILDS, DEMO_CONTROLLERS, ENGINE_VERSION, runFight, type DemoStyle, type FightLog } from "@llm-boxing-arena/engine";
import type { SavedFight } from "../src/fight/runArenaFight";
import { FIGHT_FILE_VERSION, MAX_FIGHT_FILE_CHARS, fightFileName, loadFight, serializeFight } from "../src/fight/savedFight";

const WHEN = new Date("2026-11-26T12:00:00Z");

async function completed(seed: number, red: DemoStyle, blue: DemoStyle): Promise<SavedFight> {
  const outcome = await runFight(DEMO_BUILDS[red], DEMO_BUILDS[blue], DEMO_CONTROLLERS[red], DEMO_CONTROLLERS[blue], seed);
  if (outcome.status !== "completed") throw new Error(outcome.reason);
  return {
    app: "llm-boxing-arena",
    version: 1,
    engineVersion: ENGINE_VERSION,
    meta: {
      a: { label: "Red Fighter via OpenCode", provider: "opencode", model: "red-model" },
      b: { label: "Demo bot (swarmer)" },
    },
    log: outcome.log,
  };
}

describe("fight log export and validation", () => {
  it("round-trips several seeds to the same events, commentary and result", async () => {
    const cases: { seed: number; red: DemoStyle; blue: DemoStyle }[] = [
      { seed: 11, red: "slugger", blue: "swarmer" },
      { seed: 3, red: "outBoxer", blue: "slugger" },
      { seed: 77, red: "swarmer", blue: "outBoxer" },
      { seed: 2026, red: "slugger", blue: "outBoxer" },
    ];
    for (const c of cases) {
      const fight = await completed(c.seed, c.red, c.blue);
      const text = serializeFight(fight, WHEN);
      const file = JSON.parse(text) as { version: number; engineVersion: string; commentary: unknown[]; meta: SavedFight["meta"]; log: FightLog };
      expect(file.version).toBe(FIGHT_FILE_VERSION);
      expect(file.engineVersion).toBe(ENGINE_VERSION);
      expect(file.commentary.length).toBeGreaterThan(10);
      expect(file.meta.a).toEqual({ label: "Red Fighter via OpenCode", provider: "opencode", model: "red-model" });
      expect(text).not.toMatch(/sk-|authorization|apiKey|api_key|"prompt"/);
      const loaded = await loadFight(text);
      expect(loaded.log.rounds).toEqual(fight.log.rounds);
      expect(loaded.log.result).toEqual(fight.log.result);
      expect(loaded.log.finalState).toEqual(fight.log.finalState);
      expect(loaded.commentary?.length).toBe(file.commentary.length);
    }
  });

  it("names the file with the date and the two boxers", async () => {
    const fight = await completed(11, "slugger", "swarmer");
    expect(fightFileName(fight, WHEN)).toBe("fight-2026-11-26-Big-Tom-Hale-vs-Marco-Reyes.json");
  });

  it("strips secrets from talk and refuses to export a fight with no result", async () => {
    const fight = await completed(11, "slugger", "swarmer");
    fight.log.rounds[0]!.corner.a.talk = "ignore this sk-testsecretkey123456";
    const text = serializeFight(fight, WHEN);
    expect(text).not.toContain("sk-testsecretkey123456");
    expect(text).toContain("[redacted]");
    const loaded = await loadFight(text);
    expect(loaded.log.result).toEqual(fight.log.result);
    const aborted = { ...fight, log: { ...fight.log, result: undefined } } as unknown as SavedFight;
    expect(() => serializeFight(aborted)).toThrow(/cannot be exported/);
  });

  it("rejects corrupt, wrong-version, secret and tampered files", async () => {
    const fight = await completed(11, "slugger", "swarmer");
    const text = serializeFight(fight, WHEN);
    const file = JSON.parse(text) as { version: number; log: FightLog; meta: { a: Record<string, string> } };

    await expect(loadFight("{")).rejects.toThrow(/valid JSON/);
    await expect(loadFight("")).rejects.toThrow(/empty/);
    await expect(loadFight("x".repeat(MAX_FIGHT_FILE_CHARS + 1))).rejects.toThrow(/too large/);

    await expect(loadFight(JSON.stringify({ ...file, version: 2 }))).rejects.toThrow(/version 2/);
    await expect(loadFight(JSON.stringify({ ...file, version: "1" }))).rejects.toThrow(/version 1,/);
    const wrongLog = JSON.parse(text) as { log: { version: number } };
    wrongLog.log.version = 9;
    await expect(loadFight(JSON.stringify(wrongLog))).rejects.toThrow(/version 9/);

    const missing = JSON.parse(text) as { log: { result?: unknown } };
    delete missing.log.result;
    await expect(loadFight(JSON.stringify(missing))).rejects.toThrow(/no result/);

    const secretField = JSON.parse(text) as { apiKey?: string };
    secretField.apiKey = "sk-testsecretkey123456";
    await expect(loadFight(JSON.stringify(secretField))).rejects.toThrow(/secret|API key/);

    const secretTalk = JSON.parse(text) as { log: FightLog };
    secretTalk.log.rounds[0]!.corner.a.talk = "sk-testsecretkey123456";
    await expect(loadFight(JSON.stringify(secretTalk))).rejects.toThrow(/API key/);

    const tamperedResult = JSON.parse(text) as { log: FightLog };
    tamperedResult.log.result = { ...tamperedResult.log.result, winner: tamperedResult.log.result.winner === "a" ? "b" : "a" };
    await expect(loadFight(JSON.stringify(tamperedResult))).rejects.toThrow(/Incompatible log/);

    const tamperedEvent = JSON.parse(text) as { log: FightLog };
    const land = tamperedEvent.log.rounds[0]?.exchanges[0]?.events.find((event) => event.type === "land");
    expect(land && land.type === "land").toBe(true);
    if (land && land.type === "land") land.damage = 99;
    await expect(loadFight(JSON.stringify(tamperedEvent))).rejects.toThrow(/Incompatible log/);
  });

  it("loads the committed seed-11 sample", async () => {
    const text = readFileSync(join(__dirname, "../../samples/demo-fight-seed-11.json"), "utf8");
    const loaded = await loadFight(text);
    expect(loaded.log.seed).toBe(11);
    expect(loaded.log.result.method).toBe("TKO");
    expect(loaded.log.result.round).toBe(10);
    expect(loaded.log.result.winner).toBe("a");
    expect(loaded.meta.a.label).toBe("Demo bot (slugger)");
    expect(loaded.meta.b.label).toBe("Demo bot (swarmer)");
    expect(text).not.toMatch(/sk-|authorization|apiKey/);
  });

  it("still plays a bare engine log with no envelope", async () => {
    const fight = await completed(11, "slugger", "swarmer");
    const loaded = await loadFight(JSON.stringify(fight.log));
    expect(loaded.log.result).toEqual(fight.log.result);
    expect(loaded.log.rounds).toEqual(fight.log.rounds);
    expect(loaded.meta.a.label).toBe(fight.log.builds.a.name);
    expect(loaded.commentary?.length).toBeGreaterThan(10);
  });
});
