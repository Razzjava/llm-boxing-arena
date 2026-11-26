// Runs a whole fight: each model builds its boxer, then the engine drives both controllers.
// Any failed, timed-out or unusable model call aborts the match. The 3D playback starts only
// when the log is a completed fight.
import {
  DEMO_BUILDS, DEMO_CONTROLLERS, ENGINE_VERSION, runFight,
  type BoxerBuild, type BuildProvider, type Controller, type DemoStyle, type FightAbort, type FightLog, type FightStateView, type Side,
} from "@llm-boxing-arena/engine";
import { callModel } from "../providers/chat";
import type { Keys, ModelInfo } from "../providers/types";
import { PROVIDER_LABELS } from "../providers/types";
import { LLM_CALL_TIMEOUT_MS, askForBuild, llmController, type Ask } from "../llm/controller";
import { redactSecrets } from "../providers/secrets";
import type { Line } from "../playback/commentary";

export type CornerConfig =
  | { kind: "demo"; style: DemoStyle }
  | { kind: "llm"; model: ModelInfo; viaProxy: boolean };

export interface CornerMeta {
  label: string;
  provider?: string;
  model?: string;
}

/** What a saved fight file holds. No keys, headers or prompts, ever. */
export interface SavedFight {
  app: "llm-boxing-arena";
  version: 1;
  /** Engine that produced the log. Older files may omit it. */
  engineVersion?: string;
  meta: { a: CornerMeta; b: CornerMeta };
  log: FightLog;
  /** Spoken lines from the broadcast. Omitted on a live fight until the file is written. */
  commentary?: Line[];
}

export interface FightStatus {
  phase: "building" | "fighting" | "done" | "error";
  round: number;
  exchange: number;
  thinking: { a: boolean; b: boolean };
  talk: { a: string; b: string };
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

export interface ArenaAbort {
  status: "aborted";
  message: string;
  side: Side;
  step: string;
  reason: string;
}

export type ArenaOutcome = { status: "completed"; fight: SavedFight } | ArenaAbort;

export { LLM_CALL_TIMEOUT_MS };

export function cornerMeta(c: CornerConfig): CornerMeta {
  if (c.kind === "demo") return { label: `Demo bot (${c.style})` };
  return { label: `${c.model.name} via ${PROVIDER_LABELS[c.model.provider]}`, provider: c.model.provider, model: c.model.id };
}

export function formatFightAbort(settings: FightSettings, failure: FightAbort): string {
  const cfg = settings[failure.side];
  const corner = failure.side === "a" ? "Red corner" : "Blue corner";
  const model = cfg.kind === "demo"
    ? `demo bot, ${cfg.style}`
    : `${PROVIDER_LABELS[cfg.model.provider]}, ${cfg.model.id}`;
  const reason = failure.reason.replace(/\s+/g, " ").trim().slice(0, 300);
  return redactSecrets(`${corner} (${model}) failed at ${failure.step}: ${reason}`);
}

export async function runArenaFight(settings: FightSettings, onStatus: (s: FightStatus) => void): Promise<ArenaOutcome> {
  const callTimeoutMs = settings.callTimeoutMs ?? LLM_CALL_TIMEOUT_MS;
  const status: FightStatus = {
    phase: "building", round: 0, exchange: 0,
    thinking: { a: false, b: false }, talk: { a: "", b: "" },
  };
  const emit = () => onStatus({ ...status, thinking: { ...status.thinking }, talk: { ...status.talk } });
  emit();

  const askers = { a: makeAsk(settings, "a"), b: makeAsk(settings, "b") };
  const boxerFor = (side: Side): BoxerBuild | BuildProvider => {
    const cfg = settings[side];
    if (cfg.kind === "demo") return DEMO_BUILDS[cfg.style];
    const ask = askers[side];
    const corner = side === "a" ? "red" : "blue";
    if (!ask) return () => { throw new Error("corner has no model"); };
    return async (signal) => {
      status.thinking[side] = true;
      emit();
      try {
        const { raw } = await askForBuild(ask, corner, callTimeoutMs, signal);
        return raw;
      } finally {
        status.thinking[side] = false;
        emit();
      }
    };
  };

  const controllerFor = (side: Side): Controller => {
    const cfg = settings[side];
    const watch = {
      onThinking: (v: FightStateView) => {
        status.phase = "fighting";
        status.round = v.round;
        status.exchange = v.exchange;
        status.thinking[side] = true;
        emit();
      },
      onAnswer: (_v: FightStateView, plan: Record<string, unknown> | null) => {
        status.thinking[side] = false;
        if (plan && typeof plan.talk === "string" && plan.talk) status.talk[side] = plan.talk.slice(0, 120);
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
    const ask = askers[side];
    if (!ask) return () => { throw new Error("corner has no model"); };
    return llmController(ask, side === "a" ? "red" : "blue", callTimeoutMs, watch);
  };

  const outcome = await runFight(boxerFor("a"), boxerFor("b"), controllerFor("a"), controllerFor("b"), settings.seed, { timeoutMs: callTimeoutMs });
  if (outcome.status === "aborted") {
    status.phase = "error";
    status.thinking = { a: false, b: false };
    emit();
    return {
      status: "aborted",
      message: formatFightAbort(settings, outcome),
      side: outcome.side,
      step: outcome.step,
      reason: outcome.reason,
    };
  }
  status.phase = "done";
  status.thinking = { a: false, b: false };
  emit();
  return {
    status: "completed",
    fight: {
      app: "llm-boxing-arena",
      version: 1,
      engineVersion: ENGINE_VERSION,
      meta: { a: cornerMeta(settings.a), b: cornerMeta(settings.b) },
      log: outcome.log,
    },
  };
}

function makeAsk(settings: FightSettings, side: Side): Ask | null {
  const cfg = settings[side];
  if (cfg.kind !== "llm") return null;
  const sessionId = crypto.randomUUID(); // one stable OpenCode session per fighter per fight
  const key = settings.keys[cfg.model.provider];
  return (system, user, timeoutMs, signal) =>
    callModel({ model: cfg.model, key, system, user, sessionId, viaProxy: cfg.viaProxy, proxyBase: settings.proxyBase, timeoutMs, signal });
}
