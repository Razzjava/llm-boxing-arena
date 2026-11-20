import { describe, expect, it } from "vitest";
import zen from "./fixtures/opencode-zen-models.json";
import go from "./fixtures/opencode-go-models.json";
import {
  familyOf, groupByFamily, loadModels, parseAnthropicModels, parseOpenAIModels, parseOpenCodeModels, parseXaiModels,
} from "../src/providers/modelLists";
import { EMPTY_KEYS } from "../src/providers/types";
import { estimateFightCost, formatCost, formatContext } from "../src/providers/cost";

describe("OpenCode model list parsing (real fixtures, trimmed)", () => {
  const models = parseOpenCodeModels(zen);
  it("keeps chat models only, drops image/realtime/decision models", () => {
    const ids = models.map((m) => m.id);
    expect(ids).toContain("big-pickle");
    expect(ids).toContain("claude-fable-5");
    expect(ids).toContain("gpt-5");
    expect(ids).toContain("gemini-3.5-flash");
    expect(ids).not.toContain("jev-1.13");
    expect(ids).not.toContain("gpt-image-2.5-sunburst");
    expect(ids).not.toContain("gpt-live-1");
    expect(ids).not.toContain("grok-imagine-image-2.0");
  });
  it("records the API style, base URL, context and prices", () => {
    const claude = models.find((m) => m.id === "claude-fable-5")!;
    expect(claude.api).toBe("messages");
    expect(claude.baseUrl).toBe("https://opencode.ai/inference/anthropic/v1");
    expect(models.find((m) => m.id === "gpt-5")!.api).toBe("responses");
    expect(models.find((m) => m.id === "gemini-3.5-flash")!.api).toBe("generate-content");
    const pickle = models.find((m) => m.id === "big-pickle")!;
    expect(pickle.api).toBe("chat-completions");
    expect(pickle.contextTokens).toBe(200000);
    expect(pickle.inputPrice).toBe(0);
    expect(formatCost(estimateFightCost(pickle.inputPrice, pickle.outputPrice))).toBe("free");
  });
  it("parses the Go list with /inference/go base URLs", () => {
    const g = parseOpenCodeModels(go);
    expect(g.length).toBeGreaterThan(3);
    for (const m of g) expect(m.baseUrl.startsWith("https://opencode.ai/inference/go/")).toBe(true);
  });
  it("groups by family", () => {
    const groups = groupByFamily(models);
    expect(groups.map(([f]) => f)).toEqual([...groups.map(([f]) => f)].sort());
    expect(groups.find(([f]) => f === "gpt")).toBeTruthy();
  });
  it("survives garbage", () => {
    expect(parseOpenCodeModels(null)).toEqual([]);
    expect(parseOpenCodeModels({ data: [1, "x", { id: 3 }] })).toEqual([]);
  });
});

describe("direct provider lists", () => {
  it("OpenAI: chat models only", () => {
    const ids = parseOpenAIModels({ data: [{ id: "gpt-5.4" }, { id: "text-embedding-3-large" }, { id: "gpt-4o-realtime-preview" }, { id: "whisper-1" }, { id: "o4-mini" }, { id: "dall-e-3" }] }).map((m) => m.id);
    expect(ids).toEqual(["gpt-5.4", "o4-mini"]);
  });
  it("Anthropic: uses display names and the messages API", () => {
    const [m] = parseAnthropicModels({ data: [{ id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" }] });
    expect(m).toMatchObject({ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", api: "messages", family: "claude-sonnet" });
  });
  it("xAI: grok text models only", () => {
    expect(parseXaiModels({ data: [{ id: "grok-4" }, { id: "grok-imagine-image" }, { id: "grok-4-fast" }] }).map((m) => m.id)).toEqual(["grok-4", "grok-4-fast"]);
  });
  it("families", () => {
    expect(familyOf("gpt-5.4-mini")).toBe("gpt-5.4");
    expect(familyOf("claude-haiku-4-5")).toBe("claude-haiku");
    expect(familyOf("grok-4-fast")).toBe("grok-4");
    expect(familyOf("o3")).toBe("o-series");
  });
  it("falls back to the built-in list with a readable, key-free error", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ error: { message: "Incorrect API key provided: sk-test-abcdefgh12345" } }), { status: 401 })) as typeof fetch;
    const list = await loadModels("openai", { ...EMPTY_KEYS, openai: "sk-test-abcdefgh12345" }, "console", fakeFetch);
    expect(list.source).toBe("fallback");
    expect(list.models.length).toBeGreaterThan(2);
    expect(list.error).toContain("OpenAI 401");
    expect(list.error).not.toContain("sk-test-abcdefgh12345");
  });
  it("formats", () => {
    expect(formatContext(200000)).toBe("200k ctx");
    expect(formatContext(1000000)).toBe("1M ctx");
    expect(formatCost(estimateFightCost(3, 15))).toMatch(/^~\$0\.\d\d\/fight$/);
  });
});
