// Turning failed HTTP calls into short, readable, key-free messages.
import { redactSecrets } from "./secrets";
import { PROVIDER_LABELS, type ProviderId } from "./types";

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

const label = (p: string) => PROVIDER_LABELS[p as ProviderId] ?? p;

/** "OpenCode 401: Invalid credential" from an error response body. */
export async function readError(res: Response, provider: string, key = ""): Promise<string> {
  let detail = res.statusText || "request failed";
  try {
    const text = await res.text();
    detail = messageFromBody(text) ?? (text.slice(0, 200) || detail);
  } catch {
    // keep statusText
  }
  return redactSecrets(`${label(provider)} ${res.status}: ${detail}`, key);
}

function messageFromBody(text: string): string | null {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const e = j.error;
    if (typeof e === "string") return e;
    if (e && typeof e === "object" && typeof (e as Record<string, unknown>).message === "string") return String((e as Record<string, unknown>).message);
    if (typeof j.message === "string") return j.message;
  } catch {
    // not JSON
  }
  return null;
}

export function describeFetchError(err: unknown, provider: string, key = ""): string {
  if (err instanceof DOMException && err.name === "AbortError") return `${label(provider)}: timed out`;
  if (err instanceof TypeError) {
    const hint =
      provider === "openai"
        ? " OpenAI leaves CORS headers off error replies, so a bad key or model shows up like this. Tick 'Send via local proxy' to see the real error."
        : " Check your connection, or tick 'Send via local proxy'.";
    return `${label(provider)}: the browser couldn't read the reply (network or CORS).${hint}`;
  }
  return redactSecrets(err instanceof Error ? err.message : String(err), key);
}
