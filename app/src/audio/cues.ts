// Which sounds and which commentary line belong to a short step of the playback clock.
// A big jump (skip, seek, replay resume) drops the backlog so audio cannot pile up.
import type { Line } from "../playback/commentary";
import type { Timeline } from "../playback/timeline";

export type SoundCue = "punch-light" | "punch-heavy" | "bell" | "roar" | "count";

/** Fight-seconds. Wider than one frame at 4x, narrower than a skip-to-result. */
export const CUE_GAP = 2.5;

function crossed(from: number, to: number, t: number): boolean {
  return t > from && t <= to;
}

export function cuesBetween(tl: Timeline, from: number, to: number): SoundCue[] {
  if (!(to > from) || to - from > CUE_GAP) return [];
  const cues: SoundCue[] = [];
  for (const seg of tl.segments) {
    if (seg.kind === "exchange") {
      if (seg.exchange === 1 && crossed(from, to, seg.start)) cues.push("bell");
      for (const { T, e } of seg.events) {
        if (!crossed(from, to, T)) continue;
        if (e.type === "land") cues.push(e.punch === "jab" || e.damage < 0.9 ? "punch-light" : "punch-heavy");
        else if (e.type === "knockdown") cues.push("roar");
        else if (e.type === "count") cues.push("count");
      }
    } else if (seg.kind === "break") {
      for (const { T, e } of seg.events) {
        if (e.type === "round-end" && crossed(from, to, T)) cues.push("bell");
      }
    }
  }
  return cues;
}

/** Keep the round bell, the roar and the count, and only the latest punches. */
export function limitCues(cues: SoundCue[]): SoundCue[] {
  const keep: SoundCue[] = [];
  let punches = 0;
  for (let i = cues.length - 1; i >= 0; i--) {
    const cue = cues[i] as SoundCue;
    if (cue === "punch-light" || cue === "punch-heavy") {
      if (punches >= 2) continue;
      punches++;
    }
    keep.push(cue);
  }
  return keep.reverse();
}

/**
 * The line to speak for this step. When several lines land in one step, only the newest
 * is returned and the rest are dropped. A busy speech engine returns null so nothing queues.
 */
export function commentaryToSpeak(lines: Line[], from: number, to: number, busy: boolean): string | null {
  if (busy || !(to > from) || to - from > CUE_GAP) return null;
  let latest: Line | null = null;
  for (const line of lines) {
    if (line.T > from && line.T <= to) latest = line;
  }
  return latest ? latest.text : null;
}
