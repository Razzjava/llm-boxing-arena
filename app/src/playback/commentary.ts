// Template commentary from engine events, plus the models' own talk as quotes. No extra AI calls.
import type { FightEvent, Side } from "@llm-boxing-arena/engine";
import type { Timeline } from "./timeline";

export interface Line {
  T: number;
  text: string;
  kind: "call" | "big" | "quote" | "ref";
  side?: Side;
}

const pick = (options: string[], seed: number) => options[Math.abs(Math.floor(seed * 7.31)) % options.length] as string;
const PUNCH_NAME: Record<string, string> = { jab: "jab", cross: "right hand", hook: "hook", uppercut: "uppercut", body: "body shot" };

export function buildCommentary(tl: Timeline): Line[] {
  const { a, b } = tl.log.builds;
  const name = (s: Side) => (s === "a" ? a : b).nickname || (s === "a" ? a : b).name;
  const opp = (s: Side): Side => (s === "a" ? "b" : "a");
  const lines: Line[] = [];

  for (const seg of tl.segments) {
    if (seg.kind === "intro") {
      lines.push({ T: seg.start + 0.5, kind: "call", text: `Welcome to the LLM Boxing Arena! ${a.name} "${a.nickname}" in the red corner, ${b.name} "${b.nickname}" in the blue.` });
      for (const s of ["a", "b"] as const) if (seg.corner[s].talk) lines.push({ T: seg.start + 3 + (s === "b" ? 1.5 : 0), kind: "quote", side: s, text: seg.corner[s].talk });
      continue;
    }
    if (seg.kind === "exchange") {
      if (seg.exchange === 1) lines.push({ T: seg.start + 0.2, kind: "ref", text: `Round ${seg.round}!` });
      for (const s of ["a", "b"] as const) if (seg.plans[s].talk) lines.push({ T: seg.start + 0.6 + (s === "b" ? 0.4 : 0), kind: "quote", side: s, text: seg.plans[s].talk });
      for (const { T, e } of seg.events) {
        const line = callFor(e, T, name, opp);
        if (line) lines.push({ T, ...line });
      }
      continue;
    }
    if (seg.kind === "break") {
      for (const { T, e } of seg.events) {
        if (e.type === "round-end") lines.push({ T, kind: "ref", text: `That's the end of round ${e.round}.` });
        if (e.type === "cut-treated") lines.push({ T, kind: "call", text: `The cutman works on ${name(e.side)}'s ${e.location}.` });
        if (e.type === "doctor-check") lines.push({ T, kind: e.allowed ? "call" : "big", text: e.allowed ? `The doctor looks at ${name(e.side)}'s cut... lets it go on.` : `The doctor has seen enough! ${name(e.side)} can't continue!` });
        if (e.type === "stoppage") lines.push({ T, kind: "big", text: `It's over! ${e.reason}.` });
      }
      if (seg.nextCorner) {
        for (const s of ["a", "b"] as const) {
          const c = seg.nextCorner[s];
          if (c.talk) lines.push({ T: seg.start + 4 + (s === "b" ? 2 : 0), kind: "quote", side: s, text: c.talk });
          if (c.tactic === "pressure") lines.push({ T: seg.start + 7 + (s === "b" ? 1 : 0), kind: "call", text: `${name(s)}'s corner wants pressure next round.` });
          if (c.tactic === "survive") lines.push({ T: seg.start + 7 + (s === "b" ? 1 : 0), kind: "call", text: `${name(s)}'s corner is telling him to survive.` });
        }
      }
      continue;
    }
    const r = tl.log.result;
    const winner = r.winner ? (r.winner === "a" ? a : b) : null;
    lines.push({
      T: seg.start + 1,
      kind: "big",
      text: winner ? `${winner.name} wins by ${r.method} in round ${r.round}! ${r.reason}.` : `It's a ${r.method}! ${r.reason}.`,
    });
  }
  return lines.sort((x, y) => x.T - y.T);
}

function callFor(e: FightEvent, T: number, name: (s: Side) => string, opp: (s: Side) => Side): Omit<Line, "T"> | null {
  switch (e.type) {
    case "land":
      if (e.counter) return { kind: "call", text: pick([`Beautiful counter ${PUNCH_NAME[e.punch]} from ${name(e.side)}!`, `${name(e.side)} times it perfectly, a counter ${PUNCH_NAME[e.punch]}!`], T) };
      if (e.damage >= 1.6) return { kind: "big", text: pick([`Huge ${PUNCH_NAME[e.punch]} by ${name(e.side)}!`, `${name(e.side)} lands a monster ${PUNCH_NAME[e.punch]}!`, `What a ${PUNCH_NAME[e.punch]} from ${name(e.side)}!`], T) };
      if (e.damage >= 1.1) return { kind: "call", text: pick([`Solid ${PUNCH_NAME[e.punch]} lands for ${name(e.side)}.`, `${name(e.side)} connects with the ${PUNCH_NAME[e.punch]}.`], T) };
      if (e.punch === "body" && Math.floor(T * 3) % 4 === 0) return { kind: "call", text: `${name(e.side)} digs to the body.` };
      return null;
    case "slip":
      return Math.floor(T * 5) % 5 === 0 ? { kind: "call", text: `${name(e.side)} slips the ${PUNCH_NAME[e.punch]}, lovely head movement.` } : null;
    case "hurt":
      return { kind: "big", text: pick([`${name(e.side)} is hurt!`, `${name(e.side)}'s legs are gone!`, `${name(e.side)} is in trouble!`], T) };
    case "knockdown":
      return { kind: "big", text: `DOWN GOES ${name(e.side).toUpperCase()}!${e.punch ? ` A ${PUNCH_NAME[e.punch]} from ${name(opp(e.side))} did it!` : ""}` };
    case "get-up":
      return { kind: "call", text: `${name(e.side)} is up at ${e.count}!` };
    case "counted-out":
      return { kind: "big", text: `...9... 10! ${name(e.side)} is counted out!` };
    case "stoppage":
      return { kind: "big", text: `The ${e.by === "doctor" ? "doctor" : "referee"} stops it! ${e.reason}.` };
    case "cut-opened":
      return { kind: "call", text: `${name(e.side)} is cut over the ${e.location}${e.cause === "clash" ? " from a clash of heads" : ""}.` };
    case "warning":
      return { kind: "ref", text: `The referee warns ${name(e.side)}: ${e.reason}.` };
    case "deduction":
      return { kind: "ref", text: `Point deducted from ${name(e.side)}! ${e.reason}.` };
    case "head-clash":
      return { kind: "call", text: "Clash of heads!" };
    case "break":
      return Math.floor(T) % 3 === 0 ? { kind: "ref", text: "Break! The referee separates them." } : null;
    default:
      return null;
  }
}

/** The last `n` lines at or before T. */
export function linesAt(lines: Line[], T: number, n = 5): Line[] {
  let hi = lines.length;
  let lo = 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid] as Line).T <= T) lo = mid + 1;
    else hi = mid;
  }
  return lines.slice(Math.max(0, lo - n), lo);
}
