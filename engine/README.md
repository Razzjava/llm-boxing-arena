# LLM Boxing Arena: fight engine

Pure, deterministic TypeScript. No DOM, no network, no LLM calls, no API keys.
Same seed + same plans = the same fight, every time, so any fight can be replayed from its JSON log.

```bash
npm install
npm test                 # Vitest
npm run typecheck
npm run demo -- 7 outBoxer slugger --json=fight.json   # one demo fight, round-by-round summary (+ optional full log)
npm run balance -- 500   # win rates, endings and punch volume over 500 seeded demo fights
```

## Shape

```ts
const outcome = await runFight(buildA, buildB, controllerA, controllerB, seed);
// controller: async (view: FightStateView, signal?) => Plan
//   view.phase === "corner"   -> return { tactic: "pressure" | "box" | "survive", talk? }
//   view.phase === "exchange" -> return { actions: [1-3 of jab|cross|hook|uppercut|body|block|slip|clinch|move], talk? }
// A throw, a timeout (default 120s) or an unusable plan aborts the match:
//   { status: "aborted", side, step, reason } — no winner and no scorecards.
// Pass a function instead of a build to make the boxer pick a model step with the same rule.
// Controllers are asked one at a time (A, then B). A failure does not ask the other side.
// The deadline aborts the signal passed into the controller.

if (outcome.status === "completed") {
  const again = await replayFight(JSON.parse(JSON.stringify(outcome.log))); // identical to the original log
}
```

Lower level: `createFight`, `resolveExchange(state, planA, planB, rng)` and `endRound(state, rng)` are pure
(input state is never mutated). `checkBuild` / `acceptBuild` accept only a legal 30-point fighter.
An illegal build aborts the boxer pick.

## Files

| File | What it does |
|---|---|
| `src/types.ts` | All data types, including the timed `FightEvent` union the 3D layer and commentary consume |
| `src/tuning.ts` | Every balance number in one place |
| `src/rng.ts` | mulberry32 seeded RNG |
| `src/boxer.ts` | Strict build checks. Illegal builds are rejected |
| `src/plans.ts` | Plan checks. Unusable plans are rejected |
| `src/state.ts` | Initial state, the controller's view (judges hidden) |
| `src/stats.ts` | Effective stats after fatigue, hurt, tactic, cuts |
| `src/exchange.ts` | `resolveExchange`: one 30-second exchange |
| `src/knockdown.ts` | Knockdown chance, the count, referee stoppages |
| `src/cuts.ts` | Opening/worsening cuts, cutman |
| `src/round.ts` | `endRound`: scoring, cutman, doctor, recovery |
| `src/judging.ts` | Three biased judges, 10-point must, UD/SD/MD/draw |
| `src/fight.ts` | `runFight`, `replayFight`, the fight log |
| `src/controllers.ts` | Demo bots: out-boxer, swarmer, slugger |
| `src/summary.ts`, `src/cli.ts`, `src/balance.ts`, `src/balance-cli.ts` | Text summary, demo CLI, balance run |

## How an exchange works
Each side's 1-3 actions split the 30 seconds evenly. A punch action is a short volley
(jab x4, cross x3, hook x2, uppercut x1, body x2). Each punch is resolved against whatever the other
boxer is doing at that moment: block (chance to stop it, a little leaks through; uppercuts split the guard),
slip (strong vs jab/cross and sets up a counter, weak vs hooks, useless vs body), move (harder to hit,
less so against a pressure fighter), clinch (punches are smothered, ref breaks it, warning then deductions),
or punching too (both easier to hit). Low stamina weakens power, speed and defence; body shots drain
stamina. Knockdowns come from a shot whose "shock" (damage, scaled up by accumulated head damage and being
hurt) passes the chin threshold; the get-up roll uses chin, stamina, health and earlier knockdowns.
A knockdown ends the action in that exchange (the count takes the time), so count events can run past t=30;
`ExchangeLog.duration` gives the true playback length.
