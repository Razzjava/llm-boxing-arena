import { describe, expect, it } from "vitest";
import { DEMO_BUILDS } from "../src/controllers.js";
import { runFight, type Controller } from "../src/fight.js";
import type { FightStateView } from "../src/state.js";

const A = DEMO_BUILDS.slugger;
const B = DEMO_BUILDS.outBoxer;

interface Mark {
  side: "a" | "b";
  phase: FightStateView["phase"];
  event: "start" | "end" | "abort";
}

function planFor(view: FightStateView, side: "a" | "b") {
  if (view.phase === "corner") return { tactic: side === "a" ? "pressure" : "survive", talk: side };
  return { actions: ["jab", "move"], talk: side };
}

describe("controllers are asked one at a time", () => {
  it("call B never starts before call A resolves, for corners and exchanges", async () => {
    const marks: Mark[] = [];
    const controller = (side: "a" | "b"): Controller => async (view) => {
      marks.push({ side, phase: view.phase, event: "start" });
      await new Promise((resolve) => setTimeout(resolve, 4));
      marks.push({ side, phase: view.phase, event: "end" });
      return planFor(view, side);
    };

    const log = await runFight(A, B, controller("a"), controller("b"), 11);

    expect(log.result).toBeTruthy();
    expect(marks.length).toBeGreaterThan(8);
    expect(marks.some((m) => m.phase === "corner")).toBe(true);
    expect(marks.some((m) => m.phase === "exchange")).toBe(true);
    for (let i = 0; i < marks.length; i += 4) {
      const aStart = marks[i];
      const aEnd = marks[i + 1];
      const bStart = marks[i + 2];
      const bEnd = marks[i + 3];
      expect(aStart).toMatchObject({ side: "a", event: "start" });
      expect(aEnd).toMatchObject({ side: "a", event: "end", phase: aStart?.phase });
      expect(bStart).toMatchObject({ side: "b", event: "start", phase: aStart?.phase });
      expect(bEnd).toMatchObject({ side: "b", event: "end", phase: aStart?.phase });
    }
    expect(log.rounds[0]?.corner.a.fallback).toBe(false);
    expect(log.rounds[0]?.corner.a.tactic).toBe("pressure");
    expect(log.rounds[0]?.exchanges[0]?.plans.b.fallback).toBe(false);
    expect(log.rounds[0]?.exchanges[0]?.plans.b.actions).toEqual(["jab", "move"]);
  });

  it("a timed-out call is aborted and falls back before the next call starts", async () => {
    const marks: Mark[] = [];
    const a: Controller = (view, signal) => {
      marks.push({ side: "a", phase: view.phase, event: "start" });
      return new Promise((_resolve, reject) => {
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        const timer = setTimeout(() => reject(new Error("hung past the deadline")), 500);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            marks.push({ side: "a", phase: view.phase, event: "abort" });
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
    };
    const b: Controller = async (view) => {
      marks.push({ side: "b", phase: view.phase, event: "start" });
      marks.push({ side: "b", phase: view.phase, event: "end" });
      return planFor(view, "b");
    };

    const log = await runFight(A, B, a, b, 12, { timeoutMs: 15 });

    expect(log.result).toBeTruthy();
    expect(marks.length).toBeGreaterThan(0);
    for (let i = 0; i < marks.length; i += 4) {
      const aStart = marks[i];
      expect(aStart).toMatchObject({ side: "a", event: "start" });
      expect(marks[i + 1]).toMatchObject({ side: "a", event: "abort", phase: aStart?.phase });
      expect(marks[i + 2]).toMatchObject({ side: "b", event: "start", phase: aStart?.phase });
      expect(marks[i + 3]).toMatchObject({ side: "b", event: "end", phase: aStart?.phase });
    }
    expect(log.rounds[0]?.corner.a).toMatchObject({ tactic: "box", fallback: true });
    expect(log.rounds[0]?.corner.a.error).toMatch(/aborted|no answer within 15ms/);
    expect(log.rounds[0]?.corner.b).toMatchObject({ tactic: "survive", fallback: false });
    const firstExchange = log.rounds[0]?.exchanges[0];
    expect(firstExchange?.plans.a).toMatchObject({ actions: ["block", "move"], fallback: true });
    expect(firstExchange?.plans.b.fallback).toBe(false);
    expect(log.rounds.every((r) => r.corner.a.fallback && r.exchanges.every((x) => x.plans.a.fallback))).toBe(true);
    expect(log.rounds.every((r) => !r.corner.b.fallback && r.exchanges.every((x) => !x.plans.b.fallback))).toBe(true);
  });
});
