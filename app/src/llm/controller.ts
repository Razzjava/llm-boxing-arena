// Turns a model into an engine Controller. The engine already falls back to block+move (or "box")
// on junk, errors and timeouts and flags it in the log; this adds JSON extraction and a circuit
// breaker so a dead key doesn't make a failing call on every exchange.
import type { Controller, FightStateView } from "@llm-boxing-arena/engine";
import { extractJson } from "../providers/json";
import { ProviderError } from "../providers/http";
import { BUILD_USER, buildSystem, fightSystem, viewMessage } from "./prompts";

/** Ask the model one thing: (system, user) -> reply text. Wraps callModel with the corner's settings. */
export type Ask = (system: string, user: string, timeoutMs: number) => Promise<string>;

export interface BuildResult {
  raw: Record<string, unknown> | null;
  text: string;
}

export async function askForBuild(ask: Ask, corner: "red" | "blue", timeoutMs = 60_000): Promise<BuildResult> {
  const text = await ask(buildSystem(corner), BUILD_USER, timeoutMs);
  return { raw: extractJson(text, ["stats"]), text };
}

export interface ControllerEvents {
  onThinking?: (view: FightStateView) => void;
  onAnswer?: (view: FightStateView, plan: Record<string, unknown> | null, error?: string) => void;
}

export function llmController(ask: Ask, corner: "red" | "blue", timeoutMs: number, events: ControllerEvents = {}): Controller {
  const system = fightSystem(corner);
  let authFailures = 0;
  return async (view: FightStateView) => {
    events.onThinking?.(view);
    if (authFailures >= 3) {
      const msg = "skipped: provider rejected the key 3 times";
      events.onAnswer?.(view, null, msg);
      throw new Error(msg);
    }
    try {
      const text = await ask(system, viewMessage(view), timeoutMs);
      const plan = extractJson(text, view.phase === "corner" ? ["tactic"] : ["actions"]);
      authFailures = 0;
      events.onAnswer?.(view, plan, plan ? undefined : "no JSON in reply");
      if (!plan) throw new Error("no JSON in reply");
      return plan;
    } catch (err) {
      if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) authFailures++;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "no JSON in reply") events.onAnswer?.(view, null, msg);
      throw err;
    }
  };
}
