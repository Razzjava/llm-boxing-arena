// Usage: npm run demo -- [seed] [red style] [blue style] [--json=fight.json]
// Styles: outBoxer, swarmer, slugger. Example: npm run demo -- 42 slugger outBoxer
import { runFight } from "./fight.js";
import { DEMO_BUILDS, DEMO_CONTROLLERS, type DemoStyle } from "./controllers.js";
import { writeFileSync } from "node:fs";
import { fightSummary } from "./summary.js";

const args = process.argv.slice(2);
const jsonPath = args.find((a) => a.startsWith("--json="))?.slice("--json=".length);
const [seedArg, redArg, blueArg] = args.filter((a) => !a.startsWith("--"));
const styles = Object.keys(DEMO_CONTROLLERS) as DemoStyle[];
const pick = (s: string | undefined, fallback: DemoStyle): DemoStyle => (styles.includes(s as DemoStyle) ? (s as DemoStyle) : fallback);
const seed = Number.isFinite(Number(seedArg)) && seedArg !== undefined ? Number(seedArg) : 7;
const red = pick(redArg, "outBoxer");
const blue = pick(blueArg, "slugger");

const outcome = await runFight(DEMO_BUILDS[red], DEMO_BUILDS[blue], DEMO_CONTROLLERS[red], DEMO_CONTROLLERS[blue], seed);
if (outcome.status === "aborted") {
  console.error(`Fight aborted (${outcome.side} at ${outcome.step}): ${outcome.reason}`);
  process.exitCode = 1;
} else {
  const log = outcome.log;
  console.log(fightSummary(log));
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify(log, null, 2));
    console.log(`\nFull fight log written to ${jsonPath}`);
  }
}
