import { afterEach, describe, expect, it } from "vitest";
import { LLM_CALL_TIMEOUT_MS, runArenaFight, type FightSettings } from "../src/fight/runArenaFight";
import type { ModelInfo } from "../src/providers/types";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const model = (id: string): ModelInfo => ({
  provider: "opencode",
  id,
  name: id,
  family: "test",
  api: "chat-completions",
  baseUrl: "https://opencode.ai/inference/openai/v1",
});

function settings(callTimeoutMs?: number): FightSettings {
  return {
    a: { kind: "llm", model: model("red-model"), viaProxy: true },
    b: { kind: "llm", model: model("blue-model"), viaProxy: true },
    keys: { openai: "", anthropic: "", xai: "", opencode: "test-key" },
    proxyBase: "/proxy",
    seed: 4,
    callTimeoutMs,
  };
}

interface Span {
  i: number;
  kind: "build" | "corner" | "exchange";
  side: "a" | "b";
  aborted: boolean;
}

function classify(init: RequestInit | undefined): { kind: Span["kind"]; side: Span["side"] } {
  const body = JSON.parse(String(init?.body)) as { messages?: { content?: string }[] };
  const system = body.messages?.[0]?.content ?? "";
  const user = body.messages?.[1]?.content ?? "";
  const side: Span["side"] = system.includes("RED corner") ? "a" : "b";
  const kind: Span["kind"] = system.includes("create your boxer")
    ? "build"
    : user.includes('"phase":"corner"')
      ? "corner"
      : "exchange";
  return { kind, side };
}

function reply(kind: Span["kind"], side: Span["side"]): string {
  if (kind === "build") {
    return JSON.stringify({
      name: side === "a" ? "Ada Stone" : "Bea Stone",
      nickname: side,
      stance: "orthodox",
      style: "slugger",
      stats: { power: 5, speed: 5, accuracy: 5, defence: 5, chin: 5, stamina: 5 },
    });
  }
  if (kind === "corner") return JSON.stringify({ tactic: "pressure", talk: side });
  return JSON.stringify({ actions: ["jab", "slip"], talk: side });
}

function jsonResponse(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Records start/end around a delayed mocked provider. Resolves only after `delayMs`, or rejects if aborted. */
function installFetch(opts: { delayMs: number; hangIndex?: number }) {
  const events: { i: number; mark: "start" | "end" }[] = [];
  const spans: Span[] = [];
  let n = 0;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const i = n++;
    const { kind, side } = classify(init);
    const hang = i === opts.hangIndex;
    events.push({ i, mark: "start" });
    let aborted = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), hang ? 10_000 : opts.delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (init?.signal?.aborted) onAbort();
        else init?.signal?.addEventListener("abort", onAbort, { once: true });
      });
      return jsonResponse(reply(kind, side));
    } finally {
      spans.push({ i, kind, side, aborted });
      events.push({ i, mark: "end" });
    }
  }) as typeof fetch;
  return { events, spans };
}

function expectStrictOrder(events: { i: number; mark: "start" | "end" }[]) {
  expect(events.length).toBeGreaterThan(0);
  expect(events.length % 2).toBe(0);
  for (let i = 0; i < events.length; i += 2) {
    expect(events[i]?.mark).toBe("start");
    expect(events[i + 1]?.mark).toBe("end");
    expect(events[i + 1]?.i).toBe(events[i]?.i);
  }
}

describe("fight model calls stay serial", () => {
  it("uses a 120s per-call timeout", () => {
    expect(LLM_CALL_TIMEOUT_MS).toBe(120_000);
  });

  it("call B never starts before call A resolves, across picks and exchanges", async () => {
    const { events, spans } = installFetch({ delayMs: 5 });
    const saved = await runArenaFight(settings(), () => {});

    expect(saved.log.result).toBeTruthy();
    expectStrictOrder(events);
    expect(spans.map((s) => s.kind)).toEqual(expect.arrayContaining(["build", "corner", "exchange"]));
    expect(spans[0]).toMatchObject({ kind: "build", side: "a", aborted: false });
    expect(spans[1]).toMatchObject({ kind: "build", side: "b", aborted: false });
    const fightCalls = spans.slice(2);
    expect(fightCalls.length).toBeGreaterThan(4);
    for (let i = 0; i < fightCalls.length; i += 2) {
      expect(fightCalls[i]).toMatchObject({ side: "a", aborted: false });
      expect(fightCalls[i + 1]).toMatchObject({ side: "b", aborted: false, kind: fightCalls[i]?.kind });
    }
    expect(saved.log.rounds[0]?.corner.a).toMatchObject({ tactic: "pressure", fallback: false });
    expect(saved.log.rounds[0]?.exchanges[0]?.plans.b.actions).toEqual(["jab", "slip"]);
  }, 20_000);

  it("a timed-out call falls back and the next call still runs after it", async () => {
    const { events, spans } = installFetch({ delayMs: 5, hangIndex: 2 });
    const saved = await runArenaFight(settings(40), () => {});

    expect(saved.log.result).toBeTruthy();
    expectStrictOrder(events);
    expect(spans[2]).toMatchObject({ kind: "corner", side: "a", aborted: true });
    expect(spans[3]).toMatchObject({ kind: "corner", side: "b", aborted: false });
    const timedOut = events.findIndex((e) => e.i === 2 && e.mark === "end");
    const nextStart = events.findIndex((e) => e.i === 3 && e.mark === "start");
    expect(timedOut).toBeGreaterThan(-1);
    expect(nextStart).toBeGreaterThan(timedOut);
    expect(saved.log.rounds[0]?.corner.a).toMatchObject({ tactic: "box", fallback: true });
    expect(saved.log.rounds[0]?.corner.a.error).toMatch(/timed out|no answer within 40ms/);
    expect(saved.log.rounds[0]?.corner.b).toMatchObject({ tactic: "pressure", fallback: false });
    expect(saved.log.rounds[0]?.exchanges[0]?.plans.a.fallback).toBe(false);
    expect(saved.log.rounds[0]?.exchanges[0]?.plans.b.fallback).toBe(false);
    expect(spans.slice(3).every((s) => !s.aborted)).toBe(true);
  }, 20_000);
});
