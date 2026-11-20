// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createProxyHandler } from "../proxy/proxy.mjs";

const SECRET = "sk-THIS-IS-A-FAKE-SECRET-1234567890";

describe("local proxy", () => {
  const logs: string[] = [];
  const upstreamCalls: { url: string; init: RequestInit }[] = [];
  const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
  let server: http.Server;
  let base = "";

  beforeAll(async () => {
    const fetchImpl = (async (url: string, init: RequestInit) => {
      upstreamCalls.push({ url, init });
      return new Response('{"error":{"type":"authentication_error","message":"Invalid credential"}}', {
        status: 401,
        headers: { "content-type": "application/json", "set-cookie": "tracking=1" },
      });
    }) as unknown as typeof fetch;
    const handler = createProxyHandler({ fetchImpl, log: (l) => logs.push(l) });
    server = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
    consoleSpies.forEach((s) => s.mockRestore());
  });

  it("forwards OpenCode inference calls with the viewer's auth header and passes the 401 back", async () => {
    const res = await fetch(`${base}/proxy/opencode/inference/openai/v1/chat/completions?key=${SECRET}`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json", "x-opencode-session": "s1", cookie: "a=b", origin: "http://localhost:5173" },
      body: JSON.stringify({ model: "x", messages: [{ role: "user", content: SECRET }] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { type: "authentication_error", message: "Invalid credential" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("set-cookie")).toBeNull();
    const call = upstreamCalls.at(-1)!;
    expect(call.url.startsWith("https://opencode.ai/inference/openai/v1/chat/completions")).toBe(true);
    const h = call.init.headers as Record<string, string>;
    expect(h.authorization).toBe(`Bearer ${SECRET}`);
    expect(h["x-opencode-session"]).toBe("s1");
    expect(h["user-agent"]).toBe("llm-boxing-arena/0.1");
    expect(h.cookie).toBeUndefined();
  });

  it("only allows listed upstream paths", async () => {
    for (const path of ["/proxy/opencode/auth/whatever", "/proxy/evil/v1/x", "/proxy/opencode/inference/../admin", "/proxy/openai/dashboard"]) {
      const res = await fetch(base + path, { headers: { authorization: `Bearer ${SECRET}` } });
      expect(res.status, path).toBe(403);
    }
  });

  it("gives no CORS headers to non-local origins", async () => {
    const res = await fetch(`${base}/proxy/opencode/zen/v1/models`, { headers: { origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never logs the key, the body or the query string", () => {
    expect(logs.length).toBeGreaterThan(3);
    for (const l of logs) {
      expect(l).not.toContain(SECRET);
      expect(l).not.toContain("?");
      expect(l).toMatch(/^(GET|POST|OPTIONS|PUT|DELETE) \/\S* -> \d{3}$/);
    }
    for (const spy of consoleSpies) for (const args of spy.mock.calls) expect(JSON.stringify(args)).not.toContain(SECRET);
  });

  it("the standalone server (npm run proxy) prints nothing secret", async () => {
    const port = 18000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, ["proxy/server.mjs"], { env: { ...process.env, PORT: String(port) } });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    const r1 = await fetch(`http://127.0.0.1:${port}/proxy/opencode/not-allowed?key=${SECRET}`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: SECRET });
    expect(r1.status).toBe(403);
    const r2 = await fetch(`http://127.0.0.1:${port}/proxy/opencode/inference/x`, { method: "OPTIONS", headers: { origin: "http://localhost:5173", "x-api-key": SECRET } });
    expect(r2.status).toBe(204);
    expect(r2.headers.get("access-control-allow-headers")).toContain("authorization");
    await new Promise((r) => setTimeout(r, 100));
    child.kill();
    expect(output).toContain("POST /opencode/not-allowed -> 403");
    expect(output).not.toContain(SECRET);
  });
});
