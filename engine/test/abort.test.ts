import { describe, expect, it } from "vitest";
import { runFight, type Controller, type FightAbort, type FightOutcome } from "../src/fight.js";
import { sanitizeActions, sanitizeTactic } from "../src/plans.js";
import type { FightStateView } from "../src/state.js";
import { bots, OUT, SLUG } from "./helpers.js";

function expectAbort(outcome: FightOutcome, partial: Partial<FightAbort> & Pick<FightAbort, "side" | "step">): FightAbort {
  expect(outcome.status).toBe("aborted");
  expect(outcome).not.toHaveProperty("log");
  const abort = outcome as FightAbort;
  expect(abort).toMatchObject(partial);
  expect(abort.reason.length).toBeGreaterThan(0);
  expect(JSON.stringify(abort)).not.toMatch(/"winner"|"method"|"scorecards"/);
  return abort;
}

const quiet = (view: FightStateView) => (view.phase === "corner" ? { tactic: "box", talk: "" } : { actions: ["move"], talk: "" });

describe("a failed model step aborts the match", () => {
  it("a throwing, timing-out or unusable boxer pick stops before any other call", async () => {
    let later = 0;
    const count = () => {
      later++;
      return OUT;
    };
    const thrown = await runFight(
      () => {
        throw new Error("socket hang up");
      },
      count,
      () => count(),
      () => count(),
      4,
    );
    expectAbort(thrown, { side: "a", step: "boxer pick", reason: "socket hang up" });
    expect(later).toBe(0);

    let aborted = false;
    let other = 0;
    const timed = await runFight(
      (signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
      () => {
        other++;
        return SLUG;
      },
      () => {
        other++;
        return quiet({ phase: "corner" } as FightStateView);
      },
      () => {
        other++;
        return quiet({ phase: "corner" } as FightStateView);
      },
      5,
      { timeoutMs: 20 },
    );
    const timeout = expectAbort(timed, { side: "a", step: "boxer pick" });
    expect(timeout.reason).toBe("timeout after 20ms");
    expect(aborted).toBe(true);
    expect(other).toBe(0);

    let askedB = 0;
    const unusable = await runFight(
      () => OUT,
      () => {
        askedB++;
        return { name: "Nope" };
      },
      () => {
        askedB++;
        return quiet({ phase: "exchange" } as FightStateView);
      },
      () => {
        askedB++;
        return quiet({ phase: "exchange" } as FightStateView);
      },
      6,
    );
    const badBuild = expectAbort(unusable, { side: "b", step: "boxer pick" });
    expect(badBuild.reason).toMatch(/^unusable response:/);
    expect(askedB).toBe(1);
  });

  it("a real person's name aborts the boxer pick and does not ask anyone else", async () => {
    const casings = ["Mike Tyson", "MIKE TYSON", "mike-tyson", "Tyson", "Ali", "Canelo!", "Muhammad Ali", "John Smith"];
    for (const name of casings) {
      let later = 0;
      const outcome = await runFight(
        () => ({ ...OUT, name }),
        () => {
          later++;
          return SLUG;
        },
        () => {
          later++;
          return quiet({ phase: "exchange" } as FightStateView);
        },
        () => {
          later++;
          return quiet({ phase: "exchange" } as FightStateView);
        },
        4,
      );
      const abort = expectAbort(outcome, { side: "a", step: "boxer pick" });
      expect(abort.reason).toMatch(/^used a real person's name \(".*"\); stage names only$/);
      expect(abort.reason).toContain(name.replace(/\s+/g, " ").trim());
      expect(later).toBe(0);
    }

    let blueAsked = 0;
    const blue = await runFight(
      OUT,
      () => ({ ...SLUG, name: "Canelo", nickname: "The Ghost" }),
      () => {
        blueAsked++;
        return quiet({ phase: "corner" } as FightStateView);
      },
      () => {
        blueAsked++;
        return quiet({ phase: "corner" } as FightStateView);
      },
      5,
    );
    const blueAbort = expectAbort(blue, { side: "b", step: "boxer pick" });
    expect(blueAbort.reason).toBe('used a real person\'s name ("Canelo"); stage names only');
    expect(blueAsked).toBe(0);
  });

  it("a failed corner tactic aborts with the round and asks nobody else", async () => {
    const calls: string[] = [];
    const a: Controller = (view, signal) => {
      calls.push(`a:${view.phase}:${view.round}`);
      if (view.round === 4 && view.phase === "corner") {
        return new Promise((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("hung")), 500);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
      }
      return quiet(view);
    };
    const b: Controller = (view) => {
      calls.push(`b:${view.phase}:${view.round}`);
      return quiet(view);
    };
    const outcome = await runFight(OUT, SLUG, a, b, 8, { timeoutMs: 25 });
    const abort = expectAbort(outcome, { side: "a", step: "round 4 corner tactic" });
    expect(abort.reason).toBe("timeout after 25ms");
    expect(calls.at(-1)).toBe("a:corner:4");
    expect(calls.filter((c) => c.startsWith("b:")).length).toBe(calls.filter((c) => c.startsWith("a:")).length - 1);
    expect(calls.some((c) => c.includes(":4") && c.includes("exchange"))).toBe(false);
  });

  it("an unusable or failed exchange action aborts with the round and exchange", async () => {
    const calls: string[] = [];
    const a: Controller = (view) => {
      calls.push("a");
      if (view.phase === "exchange" && view.round === 2 && view.exchange === 3) return { actions: ["kick"] };
      return quiet(view);
    };
    const b: Controller = (view) => {
      calls.push("b");
      return quiet(view);
    };
    const unusable = await runFight(OUT, SLUG, a, b, 9);
    const bad = expectAbort(unusable, { side: "a", step: "round 2, exchange 3 action" });
    expect(bad.reason).toMatch(/unusable response: invalid action "kick"/);
    expect(calls.at(-1)).toBe("a");
    expect(calls.filter((c) => c === "b").length).toBe(calls.filter((c) => c === "a").length - 1);

    const httpCalls: string[] = [];
    const throwing: Controller = (view) => {
      httpCalls.push(`a:${view.phase}:${view.exchange}`);
      if (view.phase === "exchange") throw new Error("OpenCode 503: overloaded");
      return { tactic: "pressure", talk: "go" };
    };
    const other: Controller = (view) => {
      httpCalls.push(`b:${view.phase}:${view.exchange}`);
      return view.phase === "corner" ? { tactic: "survive", talk: "" } : { actions: ["jab"], talk: "" };
    };
    const failed = await runFight(OUT, SLUG, throwing, other, 10);
    expectAbort(failed, { side: "a", step: "round 1, exchange 1 action", reason: "OpenCode 503: overloaded" });
    expect(httpCalls).toEqual(["a:corner:0", "b:corner:0", "a:exchange:1"]);
  });

  it("accepts aliases and a legal tactic, and rejects an illegal tactic without substituting box", () => {
    expect(sanitizeActions({ actions: ["JAB", "body shot", "guard"] })).toEqual({
      ok: true,
      plan: { actions: ["jab", "body", "block"], talk: "" },
    });
    expect(sanitizeActions({ actions: ["kick"] }).ok).toBe(false);
    expect(sanitizeActions({ actions: ["jab", "cross", "hook", "uppercut"] }).ok).toBe(false);
    expect(sanitizeTactic({ tactic: "BOX", talk: "  hi <b> " })).toEqual({ ok: true, plan: { tactic: "box", talk: "hi b" } });
    const bad = sanitizeTactic({ tactic: "maul" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/unusable response: invalid tactic "maul"/);
  });

  it("controllers still see only their own side, with no judges' scores", async () => {
    const seen: FightStateView[] = [];
    const spy: Controller = (view) => {
      seen.push(view);
      return bots.outBoxer(view);
    };
    const outcome = await runFight(OUT, SLUG, spy, bots.slugger, 13);
    expect(outcome.status).toBe("completed");
    expect(seen.length).toBeGreaterThan(6);
    expect(seen.every((v) => v.you === "a" && v.me.name === OUT.name)).toBe(true);
    expect(JSON.stringify(seen)).not.toMatch(/scorecard|judge/i);
  });
});
