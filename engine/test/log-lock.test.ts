// The visual pass must not change a single byte of engine output. These hashes are
// SHA-256 of JSON.stringify(log) for the demo fights the app and the README use.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEMO_BUILDS, DEMO_CONTROLLERS, type DemoStyle } from "../src/controllers.js";
import { runFight } from "../src/fight.js";

const LOCKED: { seed: number; red: DemoStyle; blue: DemoStyle; sha256: string }[] = [
  { seed: 11, red: "slugger", blue: "swarmer", sha256: "349b4ee5883fe8451a07e1e0256557687b990d8278d75f592f09e730a0bd36fc" },
  { seed: 7, red: "outBoxer", blue: "slugger", sha256: "521b513f30b4a5e71509594a2d2526fd1dabf4dac5571424eff12cac486fa801" },
];

describe("demo fight logs stay byte-identical", () => {
  it.each(LOCKED)("seed $seed $red vs $blue", async ({ seed, red, blue, sha256 }) => {
    const outcome = await runFight(DEMO_BUILDS[red], DEMO_BUILDS[blue], DEMO_CONTROLLERS[red], DEMO_CONTROLLERS[blue], seed);
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    const bytes = JSON.stringify(outcome.log);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  });
});
