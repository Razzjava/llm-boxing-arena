// What the models are told. Short on purpose: every exchange is a separate call.
import type { FightStateView } from "@llm-boxing-arena/engine";

export const RULES = `You are an AI boxer in a simulated 12-round boxing match (6 exchanges of 30 seconds per round).
A deterministic engine resolves the punches; you only choose tactics.
Actions (pick 1-3 per exchange; they split the 30 seconds evenly):
- jab: 4 quick, accurate, cheap lead-hand shots. cross: 3 rear-hand power shots.
- hook: 2 heavy shots, good vs slips. uppercut: 1 big shot that splits a block, risky.
- body: 2 body shots that drain the opponent's stamina.
- block: stop most punches, a little leaks through (uppercuts split the guard).
- slip: dodge jabs/crosses and counter, weak vs hooks, useless vs body shots.
- move: harder to hit, scores nothing. clinch: smother punches; the referee warns, then deducts points.
Low stamina weakens everything. Knockdowns come from big shots on a hurt or tired boxer.
Between rounds choose a tactic: "pressure" (aggressive), "box" (balanced) or "survive" (defensive).`;

export function buildSystem(corner: "red" | "blue"): string {
  return `${RULES}
You are in the ${corner.toUpperCase()} corner. First, create your boxer.
Reply with ONLY a JSON object, no prose:
{"name": string (max 24 chars), "nickname": string, "stance": "orthodox"|"southpaw",
 "style": "out-boxer"|"swarmer"|"slugger"|"counter-puncher",
 "stats": {"power": n, "speed": n, "accuracy": n, "defence": n, "chin": n, "stamina": n}}
Each stat is a whole number 1-10 and the six stats must total exactly 30.`;
}

export const BUILD_USER = "Build your boxer now. JSON only.";

export function fightSystem(corner: "red" | "blue"): string {
  return `${RULES}
You are in the ${corner.toUpperCase()} corner. You will be shown the fight state as JSON.
If "phase" is "exchange", reply with ONLY: {"actions": ["jab","cross","slip"], "talk": "optional short line"}
If "phase" is "corner", reply with ONLY: {"tactic": "pressure"|"box"|"survive", "talk": "optional short line"}
"talk" is trash talk or corner chatter, max 100 characters, shown to viewers. No prose outside the JSON.`;
}

export function viewMessage(view: FightStateView): string {
  return JSON.stringify(view);
}
