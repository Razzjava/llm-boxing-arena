import { describe, expect, it } from "vitest";
import { buildRequest, callModel, readText, proxiedUrl } from "../src/providers/chat";
import { direct } from "../src/providers/modelLists";
import type { ModelInfo } from "../src/providers/types";

const base = { key: "sk-fake", system: "sys", user: "usr", sessionId: "sess-1", proxyBase: "/proxy", timeoutMs: 1000 };
const oc = (api: ModelInfo["api"], baseUrl = "https://opencode.ai/inference/openai/v1"): ModelInfo => ({ provider: "opencode", id: "m", name: "m", family: "f", api, baseUrl });

describe("request building", () => {
  it("routes OpenCode through the proxy with a session id and client id", () => {
    const { url, init } = buildRequest({ ...base, model: oc("chat-completions"), viaProxy: false });
    expect(url).toBe("/proxy/opencode/inference/openai/v1/chat/completions");
    const h = init.headers as Record<string, string>;
    expect(h["x-opencode-session"]).toBe("sess-1");
    expect(h["x-opencode-client"]).toBe("llm-boxing-arena/0.1");
    expect(h.authorization).toBe("Bearer sk-fake");
  });
  it("calls Anthropic directly with the browser-access header", () => {
    const { url, init } = buildRequest({ ...base, model: direct("anthropic", "claude-x"), viaProxy: false });
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const h = init.headers as Record<string, string>;
    expect(h["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(h["x-api-key"]).toBe("sk-fake");
  });
  it("can send a direct provider via the proxy", () => {
    expect(buildRequest({ ...base, model: direct("xai", "grok-4"), viaProxy: true }).url).toBe("/proxy/xai/v1/chat/completions");
    expect(proxiedUrl("https://api.openai.com/v1/chat/completions", "http://localhost:8787/proxy/")).toBe("http://localhost:8787/proxy/openai/v1/chat/completions");
  });
  it("builds Gemini-style and Responses-style bodies", () => {
    expect(buildRequest({ ...base, model: oc("generate-content", "https://opencode.ai/inference/google/v1beta"), viaProxy: false }).url).toBe("/proxy/opencode/inference/google/v1beta/models/m:generateContent");
    const r = buildRequest({ ...base, model: oc("responses"), viaProxy: false });
    expect(JSON.parse(r.init.body as string)).toMatchObject({ instructions: "sys", input: "usr" });
  });
});

describe("reading replies", () => {
  it("reads all four shapes", () => {
    expect(readText({ choices: [{ message: { content: "a" } }] })).toBe("a");
    expect(readText({ content: [{ type: "text", text: "b" }] })).toBe("b");
    expect(readText({ output: [{ type: "message", content: [{ type: "output_text", text: "c" }] }] })).toBe("c");
    expect(readText({ candidates: [{ content: { parts: [{ text: "d" }] } }] })).toBe("d");
    expect(readText(null)).toBe("");
  });
  it("turns a 401 into a readable error without the key", async () => {
    const fetchImpl = (async () => new Response('{"error":{"type":"authentication_error","message":"Invalid credential"}}', { status: 401 })) as typeof fetch;
    await expect(callModel({ ...base, key: "sk-secret-key-123456", model: oc("chat-completions"), viaProxy: false, fetchImpl })).rejects.toThrow("OpenCode 401: Invalid credential");
  });
  it("explains a CORS/network failure", async () => {
    const fetchImpl = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    await expect(callModel({ ...base, model: direct("openai", "gpt-5"), viaProxy: false, fetchImpl })).rejects.toThrow(/couldn't read the reply/);
  });
});
