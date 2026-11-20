// Runs many seeded demo fights and reports win rates, endings and punch volume.
import { runFight } from "./fight.js";
import { DEMO_BUILDS, DEMO_CONTROLLERS, type DemoStyle } from "./controllers.js";
import type { EndMethod } from "./types.js";

export interface BalanceReport {
  fights: number;
  matchups: { a: DemoStyle; b: DemoStyle; fights: number; winsA: number; winsB: number; draws: number }[];
  methods: Record<EndMethod, number>;
  stoppageRate: number;
  avgLandedPerRoundPerBoxer: number;
  avgThrownPerRoundPerBoxer: number;
  avgRounds: number;
  knockdownsPerFight: number;
  fallbacks: number;
}

const PAIRS: [DemoStyle, DemoStyle][] = [
  ["outBoxer", "swarmer"],
  ["swarmer", "slugger"],
  ["slugger", "outBoxer"],
];

export async function runBalance(fights = 500, firstSeed = 1): Promise<BalanceReport> {
  const methods: Record<EndMethod, number> = { KO: 0, TKO: 0, UD: 0, SD: 0, MD: 0, draw: 0, TD: 0 };
  const matchups = PAIRS.map(([a, b]) => ({ a, b, fights: 0, winsA: 0, winsB: 0, draws: 0 }));
  let landed = 0;
  let thrown = 0;
  let roundsFought = 0;
  let knockdowns = 0;
  let fallbacks = 0;

  for (let i = 0; i < fights; i++) {
    const m = matchups[i % matchups.length] as (typeof matchups)[number];
    // Alternate corners so red/blue order can't skew the numbers.
    const swap = Math.floor(i / matchups.length) % 2 === 1;
    const [red, blue] = swap ? [m.b, m.a] : [m.a, m.b];
    const log = await runFight(DEMO_BUILDS[red], DEMO_BUILDS[blue], DEMO_CONTROLLERS[red], DEMO_CONTROLLERS[blue], firstSeed + i);
    const res = log.result;
    m.fights++;
    methods[res.method]++;
    if (res.winner === null) m.draws++;
    else if ((res.winner === "a") !== swap) m.winsA++;
    else m.winsB++;
    for (const r of log.rounds) {
      for (const x of r.exchanges) {
        for (const e of x.events) {
          if (e.type === "land") landed++;
          if (e.type === "throw") thrown++;
          if (e.type === "knockdown") knockdowns++;
        }
        if (x.plans.a.fallback) fallbacks++;
        if (x.plans.b.fallback) fallbacks++;
      }
    }
    // A stopped round counts as the fraction of exchanges fought.
    roundsFought += log.rounds.reduce((sum, r) => sum + r.exchanges.length / 6, 0);
  }

  const stoppages = methods.KO + methods.TKO;
  return {
    fights,
    matchups,
    methods,
    stoppageRate: stoppages / fights,
    avgLandedPerRoundPerBoxer: landed / roundsFought / 2,
    avgThrownPerRoundPerBoxer: thrown / roundsFought / 2,
    avgRounds: roundsFought / fights,
    knockdownsPerFight: knockdowns / fights,
    fallbacks,
  };
}
