// Shared provider types. Keys are plain strings held in React state only (see ui/KeyPanel.tsx).

export type ProviderId = "openai" | "anthropic" | "xai" | "opencode";
export type OpenCodePlan = "console" | "go";
/** The wire format a model is called with. Direct providers use their native one. */
export type ApiStyle = "chat-completions" | "responses" | "messages" | "generate-content";

export interface Keys {
  openai: string;
  anthropic: string;
  xai: string;
  opencode: string;
}

export const EMPTY_KEYS: Keys = { openai: "", anthropic: "", xai: "", opencode: "" };

export interface ModelInfo {
  provider: ProviderId;
  id: string;
  name: string;
  family: string;
  api: ApiStyle;
  /** Upstream base URL, e.g. https://opencode.ai/inference/openai/v1 */
  baseUrl: string;
  contextTokens?: number;
  /** USD per million tokens, when the list publishes it. */
  inputPrice?: number;
  outputPrice?: number;
}

export interface ModelList {
  models: ModelInfo[];
  source: "live" | "fallback";
  error?: string;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  xai: "xAI",
  opencode: "OpenCode",
};

export const PROVIDER_IDS: ProviderId[] = ["openai", "anthropic", "xai", "opencode"];

export const CLIENT_ID = "llm-boxing-arena/0.1";
