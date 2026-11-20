// Playback clock. The scene reads `T` every frame; the HUD polls a snapshot a few times a second.
import { BASE_RATE, type Timeline } from "./timeline";

export type Speed = 1 | 2 | 4;
export const REPLAY_RATE = 0.45; // fraction of 1x during instant replays (times the knockdown slow-down)

interface Replay {
  from: number;
  to: number;
  resumeAt: number;
  side: "a" | "b";
}

/** When each knockdown's replay should fire: after the count is over (get-up/counted out). */
export function replayPoints(tl: Timeline): { kdT: number; fireAt: number; side: "a" | "b" }[] {
  return tl.knockdowns.map((kd) => {
    const seg = tl.segments[kd.segment];
    let end = kd.T + 4;
    if (seg && seg.kind === "exchange") {
      const after = seg.events.find((x) => x.T > kd.T && (x.e.type === "get-up" || x.e.type === "counted-out" || x.e.type === "stoppage") && ("side" in x.e ? x.e.side === kd.side : true));
      if (after) end = after.T + (after.e.type === "get-up" ? 1.5 : 2.5);
    }
    return { kdT: kd.T, fireAt: Math.min(end, tl.duration - 0.01), side: kd.side };
  });
}

export class PlaybackStore {
  T = 0;
  speed: Speed = 1;
  playing = true;
  autoReplay = true;
  replay: Replay | null = null;
  private fired = new Set<number>();
  private points: ReturnType<typeof replayPoints>;

  constructor(readonly tl: Timeline) {
    this.points = replayPoints(tl);
  }

  tick(dtReal: number) {
    if (!this.playing) return;
    const dt = Math.min(dtReal, 0.1);
    if (this.replay) {
      this.T += dt * BASE_RATE * REPLAY_RATE;
      if (this.T >= this.replay.to) {
        this.T = this.replay.resumeAt;
        this.replay = null;
      }
      return;
    }
    const prev = this.T;
    this.T = Math.min(this.tl.duration, this.T + dt * BASE_RATE * this.speed);
    this.points.forEach((p, i) => {
      if (this.fired.has(i) || prev >= p.fireAt || this.T < p.fireAt) return;
      this.fired.add(i);
      if (this.autoReplay) {
        this.replay = { from: p.kdT - 2.2, to: p.kdT + 1.6, resumeAt: this.T, side: p.side };
        this.T = this.replay.from;
      }
    });
  }

  skipToResult() {
    this.replay = null;
    this.points.forEach((_, i) => this.fired.add(i));
    this.T = this.tl.resultStart;
    this.playing = true;
  }

  restart() {
    this.replay = null;
    this.fired.clear();
    this.T = 0;
    this.playing = true;
  }

  /** Real seconds left at the current speed (ignores replays). */
  remainingSeconds(): number {
    return (this.tl.duration - this.T) / (BASE_RATE * this.speed);
  }
}
