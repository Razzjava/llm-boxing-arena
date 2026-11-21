// One function to ask any model one question and get its text back.
// Direct providers are called straight from the browser; OpenCode (and any provider the viewer
// ticks "via proxy" for) goes through the local stateless proxy at `${proxyBase}/<provider>/...`.
import type { ModelInfo } from "./types";
import { CLIENT_ID } from "./types";
import { ProviderError, describeFetchError, readError } from "./http";

export interface ChatRequest {
  model: ModelInfo;
  key: string;
  system: string;
  user: string;
  /** Stable per fighter, sent to OpenCode as x-opencode-session. */
  sessionId: string;
  viaProxy: boolean;
  /** Same-origin "/proxy" under `npm run dev`/`preview`, or e.g. http://localhost:8787/proxy. */
  proxyBase: string;
  timeoutMs: number;
  /** Aborts the request immediately, in addition to `timeoutMs`. */
  signal?: AbortSignal;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

const UPSTREAM_HOSTS: Record<string, string> = {
  "https://opencode.ai": "opencode",
  "https://api.openai.com": "openai",
  "https://api.anthropic.com": "anthropic",
  "https://api.x.ai": "xai",
};

/** https://opencode.ai/inference/openai/v1 -> /proxy/opencode/inference/openai/v1 */
export function proxiedUrl(url: string, proxyBase: string): string {
  for (const [host, route] of Object.entries(UPSTREAM_HOSTS)) {
    if (url.startsWith(host + "/")) return `${proxyBase.replace(/\/+$/, "")}/${route}${url.slice(host.length)}`;
  }
  throw new Error(`no proxy route for ${new URL(url).host}`);
}

export function buildRequest(req: ChatRequest): { url: string; init: RequestInit } {
  const { model, key, system, user } = req;
  const maxTokens = req.maxTokens ?? 1200;
  const headers: Record<string, string> = { "content-type": "application/json" };
  let path: string;
  let body: unknown;

  switch (model.api) {
    case "messages":
      path = "/messages";
      headers["anthropic-version"] = "2023-06-01";
      if (model.provider === "anthropic") {
        headers["x-api-key"] = key;
        headers["anthropic-dangerous-direct-browser-access"] = "true";
      } else headers.authorization = `Bearer ${key}`;
      body = { model: model.id, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] };
      break;
    case "responses":
      path = "/responses";
      headers.authorization = `Bearer ${key}`;
      body = { model: model.id, instructions: system, input: user, max_output_tokens: maxTokens };
      break;
    case "generate-content":
      path = `/models/${encodeURIComponent(model.id)}:generateContent`;
      headers.authorization = `Bearer ${key}`;
      body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      };
      break;
    default:
      path = "/chat/completions";
      headers.authorization = `Bearer ${key}`;
      body = {
        model: model.id,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      };
  }
  if (model.provider === "opencode") {
    headers["x-opencode-session"] = req.sessionId;
    headers["x-opencode-client"] = CLIENT_ID;
  }
  const upstream = model.baseUrl + path;
  const url = req.viaProxy || model.provider === "opencode" ? proxiedUrl(upstream, req.proxyBase) : upstream;
  return { url, init: { method: "POST", headers, body: JSON.stringify(body) } };
}

/** Text out of any of the four response shapes. */
export function readText(json: unknown): string {
  const j = (json ?? {}) as Record<string, any>;
  if (Array.isArray(j.choices)) {
    const c = j.choices[0]?.message?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((p: any) => p?.text ?? "").join("");
  }
  if (Array.isArray(j.content)) return j.content.map((p: any) => (p?.type === "text" ? p.text : "")).join("");
  if (typeof j.output_text === "string") return j.output_text;
  if (Array.isArray(j.output)) {
    return j.output
      .flatMap((o: any) => (Array.isArray(o?.content) ? o.content : []))
      .map((p: any) => p?.text ?? "")
      .join("");
  }
  if (Array.isArray(j.candidates)) {
    const parts = j.candidates[0]?.content?.parts;
    if (Array.isArray(parts)) return parts.map((p: any) => p?.text ?? "").join("");
  }
  return "";
}

export async function callModel(req: ChatRequest): Promise<string> {
  const { url, init } = buildRequest(req);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  const onCallerAbort = () => controller.abort();
  if (req.signal) {
    if (req.signal.aborted) controller.abort();
    else req.signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  try {
    const res = await (req.fetchImpl ?? fetch)(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new ProviderError(await readError(res, req.model.provider, req.key), res.status);
    return readText(await res.json());
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(describeFetchError(err, req.model.provider, req.key));
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", onCallerAbort);
  }
}
