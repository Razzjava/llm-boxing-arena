// Plain-text round-by-round summary of a fight log (used by the CLI).
import type { FightEvent, Side } from "./types.js";
import type { FightLog } from "./fight.js";

export function fightSummary(log: FightLog): string {
  const { a, b } = log.builds;
  const name = (side: Side) => (side === "a" ? a.name : b.name);
  const lines: string[] = [];
  const statLine = (x: typeof a) =>
    `${x.name} "${x.nickname}" (${x.style}, ${x.stance}) P${x.stats.power} S${x.stats.speed} A${x.stats.accuracy} D${x.stats.defence} C${x.stats.chin} St${x.stats.stamina}`;
  lines.push(`Seed ${log.seed}`, `RED:  ${statLine(a)}`, `BLUE: ${statLine(b)}`, "");

  for (const r of log.rounds) {
    const events: FightEvent[] = r.exchanges.flatMap((x) => x.events);
    const n = (type: FightEvent["type"], side: Side) => events.filter((e) => e.type === type && "side" in e && e.side === side).length;
    const notes: string[] = [];
    for (const e of events) {
      if (e.type === "knockdown") notes.push(`${name(e.side)} DOWN${e.punch ? ` (${e.punch})` : ""}`);
      if (e.type === "hurt") notes.push(`${name(e.side)} hurt`);
      if (e.type === "cut-opened") notes.push(`${name(e.side)} cut ${e.location}${e.cause === "clash" ? " (clash)" : ""}`);
      if (e.type === "deduction") notes.push(`${name(e.side)} -1 for holding`);
      if (e.type === "stoppage") notes.push(`STOPPED (${e.by}): ${e.reason}`);
      if (e.type === "counted-out") notes.push(`${name(e.side)} counted out`);
    }
    for (const e of r.betweenRounds) if (e.type === "stoppage") notes.push(`STOPPED (${e.by}): ${e.reason}`);
    const scored = r.betweenRounds.find((e) => e.type === "round-scored");
    const cards = scored && scored.type === "round-scored" ? scored.cards.map((c) => `${c.a}-${c.b}`).join(" ") : "not scored";
    lines.push(
      `R${String(r.round).padStart(2)} [${r.corner.a.tactic}/${r.corner.b.tactic}]  landed ${n("land", "a")}/${n("throw", "a")} vs ${n("land", "b")}/${n("throw", "b")}  cards ${cards}` +
        (notes.length ? `  | ${notes.join("; ")}` : ""),
    );
  }

  const res = log.result;
  const fs = log.finalState;
  lines.push(
    "",
    `Final health: ${a.name} head ${Math.round(fs.a.headHealth)} body ${Math.round(fs.a.bodyHealth)} | ${b.name} head ${Math.round(fs.b.headHealth)} body ${Math.round(fs.b.bodyHealth)}`,
  );
  for (const c of res.scorecards) lines.push(`${c.judge} (${c.bias}): ${c.totalA}-${c.totalB}`);
  const clock = `${Math.floor(res.time / 60)}:${String(res.time % 60).padStart(2, "0")}`;
  lines.push(
    res.winner
      ? `RESULT: ${name(res.winner)} wins by ${res.method}, round ${res.round} at ${clock} — ${res.reason}`
      : `RESULT: ${res.method} after round ${res.round} — ${res.reason}`,
  );
  return lines.join("\n");
}
