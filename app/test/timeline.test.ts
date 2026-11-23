import { describe, expect, it } from "vitest";
import { DEMO_BUILDS, DEMO_CONTROLLERS, replayFight, runFight, type FightLog } from "@llm-boxing-arena/engine";
import { buildTimeline, clockAt, segmentAt, vitalsAt } from "../src/playback/timeline";
import { buildCommentary, linesAt } from "../src/playback/commentary";

async function demoLog(seed: number, red: "slugger" | "outBoxer" = "slugger", blue: "swarmer" | "slugger" = "swarmer"): Promise<FightLog> {
  const outcome = await runFight(DEMO_BUILDS[red], DEMO_BUILDS[blue], DEMO_CONTROLLERS[red], DEMO_CONTROLLERS[blue], seed);
  if (outcome.status !== "completed") throw new Error(outcome.reason);
  return outcome.log;
}

describe("playback timeline", () => {
  it("steps the engine to exactly the logged final state, and replay is identical", async () => {
    const log = await demoLog(11);
    const tl = buildTimeline(log);
    expect(tl.finalState).toEqual(log.finalState);
    expect(JSON.stringify(await replayFight(JSON.parse(JSON.stringify(log))))).toBe(JSON.stringify(log));
    expect(tl.segments[0]!.kind).toBe("intro");
    expect(tl.segments.at(-1)!.kind).toBe("result");
    expect(tl.knockdowns.length).toBeGreaterThan(0);
    // segments are contiguous
    for (let i = 1; i < tl.segments.length; i++) expect(tl.segments[i]!.start).toBeCloseTo(tl.segments[i - 1]!.start + tl.segments[i - 1]!.duration);
  });
  it("answers time queries", async () => {
    const log = await demoLog(7, "outBoxer", "slugger");
    const tl = buildTimeline(log);
    const firstEx = tl.segments[1]!;
    expect(segmentAt(tl, firstEx.start + 1).index).toBe(1);
    expect(clockAt(tl, firstEx.start + 15)).toEqual({ round: 1, label: "0:15" });
    const v0 = vitalsAt(tl, firstEx.start);
    const v1 = vitalsAt(tl, firstEx.start + firstEx.duration - 0.001);
    expect(v0.a.head).toBe(100);
    expect(v1.b.head).toBeLessThanOrEqual(v0.b.head);
    const lines = buildCommentary(tl);
    expect(lines.length).toBeGreaterThan(20);
    expect(linesAt(lines, tl.duration).at(-1)!.text).toMatch(/wins|draw/i);
  });
});
