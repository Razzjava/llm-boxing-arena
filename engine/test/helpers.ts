import { DEMO_BUILDS, DEMO_CONTROLLERS } from "../src/controllers.js";
import { runFight } from "../src/fight.js";
import type { BoxerBuild } from "../src/types.js";

export const OUT: BoxerBuild = DEMO_BUILDS.outBoxer;
export const SWARM: BoxerBuild = DEMO_BUILDS.swarmer;
export const SLUG: BoxerBuild = DEMO_BUILDS.slugger;
export const bots = DEMO_CONTROLLERS;

export async function fought(
  a: unknown,
  b: unknown,
  ca: Parameters<typeof runFight>[2],
  cb: Parameters<typeof runFight>[3],
  seed: number,
  options?: Parameters<typeof runFight>[5],
) {
  const outcome = await runFight(a, b, ca, cb, seed, options);
  if (outcome.status !== "completed") throw new Error(`${outcome.side} at ${outcome.step}: ${outcome.reason}`);
  return outcome.log;
}

export function demoFight(seed: number) {
  return fought(SLUG, OUT, bots.slugger, bots.outBoxer, seed);
}
