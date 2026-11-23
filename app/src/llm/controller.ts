// Turns a model into an engine Controller. Transport failures, timeouts and unusable
// replies propagate so the engine can abort the match. Nothing is replaced with a stock move.
import type { Controller, FightStateView } from "@llm-boxing-arena/engine";
import { extractJson } from "../providers/json";
import { BUILD_USER, buildSystem, fightSystem, viewMessage } from "./prompts";

/**
 * How long one model call may run before it is aborted and the match stops.
 * Long enough for a slow OpenCode reply, short enough that a dead call cannot stall the bout.
 */
export const LLM_CALL_TIMEOUT_MS = 120_000;

/** Ask the model one thing: (system, user) -> reply text. Wraps callModel with the corner's settings. */
export type Ask = (system: string, user: string, timeoutMs: number, signal?: AbortSignal) => Promise<string>;

export interface BuildResult {
  raw: Record<string, unknown>;
  text: string;
}

export async function askForBuild(ask: Ask, corner: "red" | "blue", timeoutMs = LLM_CALL_TIMEOUT_MS, signal?: AbortSignal): Promise<BuildResult> {
  const text = await ask(buildSystem(corner), BUILD_USER, timeoutMs, signal);
  const raw = extractJson(text, ["stats"]);
  if (!raw) throw new Error("unusable response: no JSON in reply");
  return { raw, text };
}

export interface ControllerEvents {
  onThinking?: (view: FightStateView) => void;
  onAnswer?: (view: FightStateView, plan: Record<string, unknown> | null) => void;
}

export function llmController(ask: Ask, corner: "red" | "blue", timeoutMs: number, events: ControllerEvents = {}): Controller {
  const system = fightSystem(corner);
  return async (view: FightStateView, signal?: AbortSignal) => {
    events.onThinking?.(view);
    try {
      const text = await ask(system, viewMessage(view), timeoutMs, signal);
      const plan = extractJson(text, view.phase === "corner" ? ["tactic"] : ["actions"]);
      if (!plan) throw new Error("unusable response: no JSON in reply");
      events.onAnswer?.(view, plan);
      return plan;
    } catch (err) {
      events.onAnswer?.(view, null);
      throw err;
    }
  };
}
