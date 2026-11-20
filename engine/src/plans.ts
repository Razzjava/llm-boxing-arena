// Turning whatever a controller returned into a legal plan. Bad input never stalls a fight.
import type { Action, Plan, Tactic } from "./types.js";

export const ACTIONS: readonly Action[] = ["jab", "cross", "hook", "uppercut", "body", "block", "slip", "clinch", "move"];
export const TACTICS: readonly Tactic[] = ["pressure", "box", "survive"];
export const FALLBACK_ACTIONS: Action[] = ["block", "move"];
export const FALLBACK_TACTIC: Tactic = "box";
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
  fallback: boolean;
}

export function sanitizeActions(raw: unknown): CleanPlan {
  const plan = isObject(raw) ? raw : {};
  const talk = cleanTalk(plan.talk);
  const list = Array.isArray(plan.actions) ? plan.actions : [];
  const actions: Action[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const key = item.toLowerCase().trim();
    const action = (ACTIONS as readonly string[]).includes(key) ? (key as Action) : ALIASES[key];
    if (action && actions.length < MAX_ACTIONS) actions.push(action);
  }
  if (actions.length === 0) return { actions: [...FALLBACK_ACTIONS], talk, fallback: true };
  return { actions, talk, fallback: false };
}

export interface CleanTactic {
  tactic: Tactic;
  talk: string;
  fallback: boolean;
}

export function sanitizeTactic(raw: unknown): CleanTactic {
  const plan = isObject(raw) ? (raw as Plan & Record<string, unknown>) : {};
  const key = typeof plan.tactic === "string" ? plan.tactic.toLowerCase().trim() : "";
  const ok = (TACTICS as readonly string[]).includes(key);
  return { tactic: ok ? (key as Tactic) : FALLBACK_TACTIC, talk: cleanTalk(plan.talk), fallback: !ok };
}

function cleanTalk(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, TALK_MAX);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
