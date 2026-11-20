import { DEMO_BUILDS, DEMO_CONTROLLERS } from "../src/controllers.js";
import { runFight } from "../src/fight.js";
import type { BoxerBuild } from "../src/types.js";

export const OUT: BoxerBuild = DEMO_BUILDS.outBoxer;
export const SWARM: BoxerBuild = DEMO_BUILDS.swarmer;
export const SLUG: BoxerBuild = DEMO_BUILDS.slugger;
export const bots = DEMO_CONTROLLERS;

export function demoFight(seed: number) {
  return runFight(SLUG, OUT, bots.slugger, bots.outBoxer, seed);
}
