// Scripted demo boxers: no keys needed, used for demo mode, tests and balance checks.
// They are deterministic: the same view always gives the same plan.
// The display names are part of the seeded fight logs (including samples/demo-fight-seed-11.json).
// A new model pick is held to stage names; these scripted builds are not renamed.
import type { Action, BoxerBuild, Plan, Tactic } from "./types.js";
import type { FightStateView } from "./state.js";
import type { Controller } from "./fight.js";

export const DEMO_BUILDS = {
  outBoxer: {
    name: "Silas Vane", nickname: "Silk", stance: "orthodox", style: "out-boxer",
    stats: { power: 3, speed: 7, accuracy: 6, defence: 6, chin: 4, stamina: 4 },
  },
  swarmer: {
    name: "Marco Reyes", nickname: "Buzzsaw", stance: "southpaw", style: "swarmer",
    stats: { power: 5, speed: 5, accuracy: 4, defence: 4, chin: 6, stamina: 6 },
  },
  slugger: {
    name: "Big Tom Hale", nickname: "The Hammer", stance: "orthodox", style: "slugger",
    stats: { power: 7, speed: 4, accuracy: 5, defence: 3, chin: 6, stamina: 5 },
  },
} satisfies Record<string, BoxerBuild>;

function pattern(view: FightStateView, options: Action[][]): Action[] {
  // Rotates through combos so fights don't look the same every exchange.
  const i = (view.round * 5 + view.exchange * 3 + view.me.headHealth) % options.length;
  return options[i] as Action[];
}

function corner(tactic: Tactic, talk: string): Plan {
  return { tactic, talk };
}

export const outBoxer: Controller = (view) => {
  if (view.phase === "corner") {
    if (view.me.staminaPercent < 35 || view.me.headHealth < 35) return corner("survive", "Stick and move, stay off the ropes.");
    if (view.opponent.headHealth < 40) return corner("pressure", "He's fading, let your hands go.");
    return corner("box", "Jab, jab, cross. Keep him at the end of it.");
  }
  if (view.me.hurt) return { actions: ["clinch", "move"] };
  if (view.me.staminaPercent < 30) return { actions: ["jab", "move", "block"] };
  return {
    actions: pattern(view, [
      ["jab", "jab", "cross"],
      ["jab", "slip", "cross"],
      ["move", "jab", "cross"],
      ["jab", "move", "jab"],
      ["slip", "cross", "move"],
      ["jab", "cross", "hook"],
    ]),
  };
};

export const swarmer: Controller = (view) => {
  if (view.phase === "corner") {
    if (view.me.staminaPercent < 40) return corner("box", "Breathe, pick your moments.");
    return corner("pressure", "Walk him down. Body, body, head.");
  }
  if (view.me.hurt) return { actions: ["clinch", "body"] };
  if (view.me.staminaPercent < 30) return { actions: ["block", "body", "move"] };
  return {
    actions: pattern(view, [
      ["body", "hook", "body"],
      ["jab", "body", "hook"],
      ["hook", "body", "uppercut"],
      ["body", "cross", "hook"],
      ["slip", "hook", "body"],
      ["body", "body", "hook"],
    ]),
  };
};

export const slugger: Controller = (view) => {
  if (view.phase === "corner") {
    if (view.opponent.headHealth < 50) return corner("pressure", "He can't take another one. Go get him.");
    if (view.me.staminaPercent < 35) return corner("survive", "Hands up, wait for the big one.");
    return corner("box", "Load up. One shot changes it.");
  }
  if (view.me.hurt) return { actions: ["clinch", "block"] };
  if (view.opponent.hurt) return { actions: ["hook", "uppercut", "cross"] };
  if (view.me.staminaPercent < 20) return { actions: ["block", "cross", "hook"] };
  return {
    actions: pattern(view, [
      ["cross", "hook", "body"],
      ["block", "hook", "uppercut"],
      ["jab", "cross", "hook"],
      ["block", "cross", "hook"],
      ["hook", "uppercut", "block"],
      ["jab", "hook", "cross"],
    ]),
  };
};

export const DEMO_CONTROLLERS = { outBoxer, swarmer, slugger };
export type DemoStyle = keyof typeof DEMO_CONTROLLERS;
