// Usage: npm run balance -- [fights]
import { runBalance } from "./balance.js";

const n = Number(process.argv[2] ?? 500);
const r = await runBalance(n);
console.log(`Fights: ${r.fights}`);
for (const m of r.matchups) {
  console.log(`  ${m.a} vs ${m.b}: ${m.winsA}-${m.winsB} (${m.draws} draws) of ${m.fights}  -> ${m.a} ${(100 * m.winsA / m.fights).toFixed(0)}%, ${m.b} ${(100 * m.winsB / m.fights).toFixed(0)}%`);
}
console.log(`Endings: ${Object.entries(r.methods).map(([k, v]) => `${k} ${v}`).join(", ")}`);
const rates = r.matchups.flatMap((m) => [m.winsA / m.fights, m.winsB / m.fights]);
const maxWin = Math.max(...rates);
console.log(`Max matchup win rate: ${(100 * maxWin).toFixed(1)}%`);
console.log(`Stoppage rate: ${(100 * r.stoppageRate).toFixed(1)}%`);
console.log(`Early stoppages (rounds 1-3): ${r.earlyStoppages} of ${r.fights} (${(100 * r.earlyStoppages / r.fights).toFixed(1)}%)`);
console.log(`Avg landed/round/boxer: ${r.avgLandedPerRoundPerBoxer.toFixed(1)}  thrown: ${r.avgThrownPerRoundPerBoxer.toFixed(1)}`);
console.log(`Avg rounds: ${r.avgRounds.toFixed(2)}  knockdowns/fight: ${r.knockdownsPerFight.toFixed(2)}  fallback plans: ${r.fallbacks}`);
