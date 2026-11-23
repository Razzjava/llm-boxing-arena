// Turning whatever a controller returned into a legal plan.
// An unusable answer aborts the match. Nothing is replaced with a stock move.
import type { Action, Plan, Tactic } from "./types.js";

export const ACTIONS: readonly Action[] = ["jab", "cross", "hook", "uppercut", "body", "block", "slip", "clinch", "move"];
export const TACTICS: readonly Tactic[] = ["pressure", "box", "survive"];
const MAX_ACTIONS = 3;
const TALK_MAX = 120;

const ALIASES: Record<string, Action> = {
  "body shot": "body",
  "body-shot": "body",
  bodyshot: "body",
  straight: "cross",
  "right hand": "cross",
  duck: "slip",
  footwork: "move",
  guard: "block",
};

export interface CleanPlan {
  actions: Action[];
  talk: string;
}

export interface CleanTactic {
  tactic: Tactic;
  talk: string;
}

export type ParsedPlan = { ok: true; plan: CleanPlan } | { ok: false; reason: string };
export type ParsedTactic = { ok: true; plan: CleanTactic } | { ok: false; reason: string };

export function sanitizeActions(raw: unknown): ParsedPlan {
  if (!isObject(raw)) return fail("not a plan");
  if (!Array.isArray(raw.actions)) return fail("no actions");
  if (raw.actions.length === 0) return fail("no actions");
  if (raw.actions.length > MAX_ACTIONS) return fail("more than 3 actions");
  const actions: Action[] = [];
  for (const item of raw.actions) {
    if (typeof item !== "string") return fail("invalid action");
    const key = item.toLowerCase().trim();
    const action = (ACTIONS as readonly string[]).includes(key) ? (key as Action) : ALIASES[key];
    if (!action) return fail(`invalid action "${item.replace(/\s+/g, " ").trim().slice(0, 40)}"`);
    actions.push(action);
  }
  return { ok: true, plan: { actions, talk: cleanTalk(raw.talk) } };
}

export function sanitizeTactic(raw: unknown): ParsedTactic {
  if (!isObject(raw)) return fail("not a plan");
  const plan = raw as Plan & Record<string, unknown>;
  const key = typeof plan.tactic === "string" ? plan.tactic.toLowerCase().trim() : "";
  if (!(TACTICS as readonly string[]).includes(key)) {
    const shown = typeof plan.tactic === "string" && plan.tactic.trim() !== "" ? ` "${plan.tactic.replace(/\s+/g, " ").trim().slice(0, 40)}"` : "";
    return fail(`invalid tactic${shown}`);
  }
  return { ok: true, plan: { tactic: key as Tactic, talk: cleanTalk(plan.talk) } };
}

function fail(detail: string): { ok: false; reason: string } {
  return { ok: false, reason: `unusable response: ${detail}` };
}

function cleanTalk(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, TALK_MAX);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
