import { describe, expect, it } from "vitest";
import { DEMO_BUILDS } from "../src/controllers.js";
import { DEFAULT_CALL_TIMEOUT_MS, runFight, type Controller, type FightOutcome } from "../src/fight.js";
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

function completed(outcome: FightOutcome) {
  expect(outcome.status).toBe("completed");
  if (outcome.status !== "completed") throw new Error("aborted");
  return outcome.log;
}

describe("controllers are asked one at a time", () => {
  it("uses a 120s default deadline", () => {
    expect(DEFAULT_CALL_TIMEOUT_MS).toBe(120_000);
  });

  it("call B never starts before call A resolves, for corners and exchanges", async () => {
    const marks: Mark[] = [];
    const controller = (side: "a" | "b"): Controller => async (view) => {
      marks.push({ side, phase: view.phase, event: "start" });
      await new Promise((resolve) => setTimeout(resolve, 4));
      marks.push({ side, phase: view.phase, event: "end" });
      return planFor(view, side);
    };

    const log = completed(await runFight(A, B, controller("a"), controller("b"), 11));

    expect(log.result.winner === "a" || log.result.winner === "b" || log.result.winner === null).toBe(true);
    expect(log.result.method).toBeTruthy();
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
    expect(log.rounds[0]?.corner.a).toEqual({ tactic: "pressure", talk: "a" });
    expect(log.rounds[0]?.corner.a).not.toHaveProperty("fallback");
    expect(log.rounds[0]?.exchanges[0]?.plans.b).toEqual({ actions: ["jab", "move"], talk: "b" });
    expect(log.rounds[0]?.exchanges[0]?.plans.b).not.toHaveProperty("fallback");
  });

  it("a timed-out call is aborted and no later call starts", async () => {
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

    const outcome = await runFight(A, B, a, b, 12, { timeoutMs: 15 });

    expect(outcome).toMatchObject({
      status: "aborted",
      side: "a",
      step: "round 1 corner tactic",
      reason: "timeout after 15ms",
    });
    expect(outcome).not.toHaveProperty("log");
    expect(marks).toEqual([
      { side: "a", phase: "corner", event: "start" },
      { side: "a", phase: "corner", event: "abort" },
    ]);
  });
});
