// Model lists: OpenCode's public lists (no key needed) and the direct providers' /models endpoints.
import type { ApiStyle, Keys, ModelInfo, ModelList, OpenCodePlan, ProviderId } from "./types";
import { describeFetchError, readError } from "./http";

export const OPENCODE_LIST_URLS: Record<OpenCodePlan, string> = {
  console: "https://opencode.ai/zen/v1/models",
  go: "https://opencode.ai/inference/go/v1/models",
};

export const DIRECT_BASE: Record<Exclude<ProviderId, "opencode">, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  xai: "https://api.x.ai/v1",
};

const SUPPORTED_STYLES: ApiStyle[] = ["chat-completions", "responses", "messages", "generate-content"];

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** OpenCode list -> chat models only, each with the API style and base URL to call it with. */
export function parseOpenCodeModels(json: unknown): ModelInfo[] {
  const data = isObj(json) && Array.isArray(json.data) ? json.data : [];
  const out: ModelInfo[] = [];
  for (const m of data) {
    if (!isObj(m) || m.type !== "chat" || typeof m.id !== "string") continue;
    const output = isObj(m.modalities) && Array.isArray(m.modalities.output) ? m.modalities.output : ["text"];
    if (!output.includes("text")) continue;
    const api = isObj(m.api) ? m.api : {};
    const recommended = typeof m.recommended_api === "string" ? (m.recommended_api as ApiStyle) : undefined;
    const order = [recommended, "chat-completions", ...SUPPORTED_STYLES].filter(Boolean) as ApiStyle[];
    const style = order.find((s) => SUPPORTED_STYLES.includes(s) && isObj(api[s]) && typeof (api[s] as Json).base_url === "string");
    if (!style) continue;
    const cost = isObj(m.cost) && isObj(m.cost.text) ? m.cost.text : {};
    const inputPrice = isObj(cost.input) ? num(cost.input.price) : undefined;
    const outputPrice = isObj(cost.output) ? num(cost.output.price) : undefined;
    out.push({
      provider: "opencode",
      id: m.id,
      name: typeof m.name === "string" ? m.name : m.id,
      family: typeof m.family === "string" && m.family ? m.family : familyOf(m.id),
      api: style,
      baseUrl: String((api[style] as Json).base_url).replace(/\/+$/, ""),
      contextTokens: isObj(m.limit) ? num(m.limit.context) : undefined,
      inputPrice,
      outputPrice,
    });
  }
  return sortModels(out);
}

const OPENAI_EXCLUDE = /(embed|whisper|tts|dall-e|image|audio|realtime|transcribe|moderation|search|computer-use|babbage|davinci|instruct|sora)/i;

export function parseOpenAIModels(json: unknown): ModelInfo[] {
  return idsFrom(json)
    .filter((id) => /^(gpt|o\d|chatgpt)/i.test(id) && !OPENAI_EXCLUDE.test(id))
    .map((id) => direct("openai", id));
}

export function parseAnthropicModels(json: unknown): ModelInfo[] {
  const data = isObj(json) && Array.isArray(json.data) ? json.data : [];
  return sortModels(
    data
      .filter((m): m is Json => isObj(m) && typeof m.id === "string" && m.id.startsWith("claude"))
      .map((m) => ({ ...direct("anthropic", m.id as string), name: typeof m.display_name === "string" ? m.display_name : (m.id as string) })),
  );
}

export function parseXaiModels(json: unknown): ModelInfo[] {
  return idsFrom(json)
    .filter((id) => /^grok/i.test(id) && !/(image|imagine|video|vision$)/i.test(id))
    .map((id) => direct("xai", id));
}

/** Used when a /models call fails. Any other id can still be typed into the picker. */
export const FALLBACK_MODELS: Record<Exclude<ProviderId, "opencode">, string[]> = {
  openai: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5", "gpt-5-mini", "gpt-4.1-mini"],
  anthropic: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5"],
  xai: ["grok-4.7", "grok-4.6", "grok-4.5", "grok-4", "grok-4-fast"],
};

export function fallbackModels(provider: Exclude<ProviderId, "opencode">): ModelInfo[] {
  return FALLBACK_MODELS[provider].map((id) => direct(provider, id));
}

export function direct(provider: Exclude<ProviderId, "opencode">, id: string): ModelInfo {
  const api: ApiStyle = provider === "anthropic" ? "messages" : "chat-completions";
  return { provider, id, name: id, family: familyOf(id), api, baseUrl: DIRECT_BASE[provider] };
}

/** "claude-sonnet-4-5" -> "claude-sonnet", "gpt-5.4-mini" -> "gpt-5.4", "grok-4-fast" -> "grok-4". */
export function familyOf(id: string): string {
  const s = id.toLowerCase();
  const claude = s.match(/^claude-(opus|sonnet|haiku|fable)/);
  if (claude) return `claude-${claude[1]}`;
  const gpt = s.match(/^gpt-(\d+(?:\.\d+)?)/);
  if (gpt) return `gpt-${gpt[1]}`;
  if (/^o\d/.test(s)) return "o-series";
  const grok = s.match(/^grok-(\d+(?:\.\d+)?)/);
  if (grok) return `grok-${grok[1]}`;
  return s.split(/[-_.:/]/)[0] || s;
}

export function groupByFamily(models: ModelInfo[]): [string, ModelInfo[]][] {
  const groups = new Map<string, ModelInfo[]>();
  for (const m of models) groups.set(m.family, [...(groups.get(m.family) ?? []), m]);
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function sortModels(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => a.family.localeCompare(b.family) || a.id.localeCompare(b.id));
}

function idsFrom(json: unknown): string[] {
  const data = isObj(json) && Array.isArray(json.data) ? json.data : [];
  return data.filter((m): m is Json => isObj(m) && typeof m.id === "string").map((m) => m.id as string).sort();
}

/** Load a provider's model list. Never throws: falls back to a built-in list with the error attached. */
export async function loadModels(
  provider: ProviderId,
  keys: Keys,
  plan: OpenCodePlan,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelList> {
  try {
    if (provider === "opencode") {
      const res = await fetchImpl(OPENCODE_LIST_URLS[plan]);
      if (!res.ok) throw new Error(await readError(res, "OpenCode"));
      const models = parseOpenCodeModels(await res.json());
      if (models.length === 0) throw new Error("OpenCode returned no chat models");
      return { models, source: "live" };
    }
    const key = keys[provider];
    const headers: Record<string, string> =
      provider === "anthropic"
        ? { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
        : { Authorization: `Bearer ${key}` };
    const res = await fetchImpl(`${DIRECT_BASE[provider]}/models${provider === "anthropic" ? "?limit=100" : ""}`, { headers });
    if (!res.ok) throw new Error(await readError(res, provider, key));
    const json: unknown = await res.json();
    const models = provider === "openai" ? parseOpenAIModels(json) : provider === "anthropic" ? parseAnthropicModels(json) : parseXaiModels(json);
    if (models.length === 0) throw new Error("no chat models in the list");
    return { models, source: "live" };
  } catch (err) {
    const message = describeFetchError(err, provider, provider === "opencode" ? "" : keys[provider]);
    if (provider === "opencode") return { models: [], source: "fallback", error: message };
    return { models: fallbackModels(provider), source: "fallback", error: message };
  }
}
