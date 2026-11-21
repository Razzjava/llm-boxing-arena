// Runs a whole fight: builds both boxers, then lets the engine drive both controllers to a result.
// The 3D playback starts once the log is complete.
import {
  DEMO_BUILDS, DEMO_CONTROLLERS, normalizeBuild, runFight,
  type BoxerBuild, type Controller, type DemoStyle, type FightLog, type FightStateView,
} from "@llm-boxing-arena/engine";
import { callModel } from "../providers/chat";
import type { Keys, ModelInfo } from "../providers/types";
import { PROVIDER_LABELS } from "../providers/types";
import { LLM_CALL_TIMEOUT_MS, askForBuild, llmController, type Ask } from "../llm/controller";
import { ProviderError } from "../providers/http";

export type CornerConfig =
  | { kind: "demo"; style: DemoStyle }
  | { kind: "llm"; model: ModelInfo; viaProxy: boolean };

export interface CornerMeta {
  label: string;
  provider?: string;
  model?: string;
}

/** What a saved fight file holds. No keys, ever. */
export interface SavedFight {
  app: "llm-boxing-arena";
  version: 1;
  meta: { a: CornerMeta; b: CornerMeta };
  log: FightLog;
}

export interface FightStatus {
  phase: "building" | "fighting" | "done" | "error";
  round: number;
  exchange: number;
  thinking: { a: boolean; b: boolean };
  talk: { a: string; b: string };
  fallbacks: { a: number; b: number };
  lastError: { a?: string; b?: string };
  notes: string[];
}

export interface FightSettings {
  a: CornerConfig;
  b: CornerConfig;
  keys: Keys;
  proxyBase: string;
  seed: number;
  /** Per-call deadline. Defaults to {@link LLM_CALL_TIMEOUT_MS}. */
  callTimeoutMs?: number;
}

export { LLM_CALL_TIMEOUT_MS };

export function cornerMeta(c: CornerConfig): CornerMeta {
  if (c.kind === "demo") return { label: `Demo bot (${c.style})` };
  return { label: `${c.model.name} via ${PROVIDER_LABELS[c.model.provider]}`, provider: c.model.provider, model: c.model.id };
}

export class FightSetupError extends Error {}

export async function runArenaFight(settings: FightSettings, onStatus: (s: FightStatus) => void): Promise<SavedFight> {
  const callTimeoutMs = settings.callTimeoutMs ?? LLM_CALL_TIMEOUT_MS;
  const status: FightStatus = {
    phase: "building", round: 0, exchange: 0,
    thinking: { a: settings.a.kind === "llm", b: false }, talk: { a: "", b: "" }, fallbacks: { a: 0, b: 0 }, lastError: {}, notes: [],
  };
  const emit = () => onStatus({ ...status, thinking: { ...status.thinking }, talk: { ...status.talk }, fallbacks: { ...status.fallbacks }, lastError: { ...status.lastError }, notes: [...status.notes] });
  emit();

  const askers = { a: makeAsk(settings, "a"), b: makeAsk(settings, "b") };
  // Builds are model calls too. Finish A (or its timeout) before asking B.
  let buildA: BoxerBuild;
  let buildB: BoxerBuild;
  try {
    buildA = await buildFor(settings.a, askers.a, "red", status, "a", callTimeoutMs);
    status.thinking.b = settings.b.kind === "llm";
    emit();
    buildB = await buildFor(settings.b, askers.b, "blue", status, "b", callTimeoutMs);
  } catch (err) {
    status.phase = "error";
    emit();
    throw err;
  }
  status.phase = "fighting";
  status.thinking = { a: false, b: false };
  emit();

  const controllerFor = (side: "a" | "b"): Controller => {
    const cfg = settings[side];
    const watch = {
      onThinking: (v: FightStateView) => {
        status.round = v.round;
        status.exchange = v.exchange;
        status.thinking[side] = true;
        emit();
      },
      onAnswer: (_v: FightStateView, plan: Record<string, unknown> | null, error?: string) => {
        status.thinking[side] = false;
        if (plan && typeof plan.talk === "string" && plan.talk) status.talk[side] = plan.talk.slice(0, 120);
        if (error) {
          status.fallbacks[side]++;
          status.lastError[side] = error;
        }
        emit();
      },
    };
    if (cfg.kind === "demo") {
      const bot = DEMO_CONTROLLERS[cfg.style];
      return (view) => {
        watch.onThinking(view);
        const plan = bot(view) as Record<string, unknown>;
        watch.onAnswer(view, plan);
        return plan;
      };
    }
    return llmController(askers[side] as Ask, side === "a" ? "red" : "blue", callTimeoutMs, watch);
  };

  const log = await runFight(buildA, buildB, controllerFor("a"), controllerFor("b"), settings.seed, { timeoutMs: callTimeoutMs });
  status.phase = "done";
  emit();
  return { app: "llm-boxing-arena", version: 1, meta: { a: cornerMeta(settings.a), b: cornerMeta(settings.b) }, log };
}

function makeAsk(settings: FightSettings, side: "a" | "b"): Ask | null {
  const cfg = settings[side];
  if (cfg.kind !== "llm") return null;
  const sessionId = crypto.randomUUID(); // one stable OpenCode session per fighter per fight
  const key = settings.keys[cfg.model.provider];
  return (system, user, timeoutMs, signal) =>
    callModel({ model: cfg.model, key, system, user, sessionId, viaProxy: cfg.viaProxy, proxyBase: settings.proxyBase, timeoutMs, signal });
}

async function buildFor(cfg: CornerConfig, ask: Ask | null, corner: "red" | "blue", status: FightStatus, side: "a" | "b", timeoutMs: number): Promise<BoxerBuild> {
  if (cfg.kind === "demo" || !ask) {
    status.thinking[side] = false;
    return DEMO_BUILDS[cfg.kind === "demo" ? cfg.style : "outBoxer"];
  }
  try {
    const { raw } = await askForBuild(ask, corner, timeoutMs);
    const fixed = normalizeBuild(raw, corner === "red" ? "Red Corner" : "Blue Corner");
    if (fixed.fixes.length) status.notes.push(`${corner.toUpperCase()} build repaired: ${fixed.fixes.join("; ")}`);
    status.thinking[side] = false;
    return fixed.build;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new FightSetupError(`${corner.toUpperCase()} corner (${cfg.model.id}): ${msg}`, { cause: err instanceof ProviderError ? err : undefined });
  }
}
