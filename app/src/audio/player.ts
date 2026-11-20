// Browser playback. Every call is guarded: headless tests have no speechSynthesis or working audio.
import { commentaryToSpeak, cuesBetween, limitCues, type SoundCue } from "./cues";
import type { Line } from "../playback/commentary";
import type { Timeline } from "../playback/timeline";

const SRC: Record<SoundCue, string> = {
  "punch-light": "/assets/sfx/punch-light.ogg",
  "punch-heavy": "/assets/sfx/punch-heavy.ogg",
  bell: "/assets/sfx/bell.ogg",
  roar: "/assets/sfx/crowd-roar.ogg",
  count: "/assets/sfx/count.ogg",
};

const GAIN: Record<SoundCue, number> = {
  "punch-light": 0.55,
  "punch-heavy": 0.85,
  bell: 0.7,
  roar: 0.95,
  count: 0.45,
};

export interface SpeechSynth {
  speaking: boolean;
  pending: boolean;
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
}

export function speakCommentary(synth: SpeechSynth | null | undefined, text: string, volume: number): "spoken" | "skipped" | "unavailable" {
  if (!synth || typeof synth.speak !== "function" || typeof synth.cancel !== "function") return "unavailable";
  if (synth.speaking || synth.pending) return "skipped";
  try {
    if (typeof SpeechSynthesisUtterance === "undefined") return "unavailable";
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = Math.min(1, Math.max(0, volume));
    utterance.rate = 1.05;
    synth.speak(utterance);
    return "spoken";
  } catch {
    return "unavailable";
  }
}

export interface AudioStep {
  from: number;
  to: number;
  muted: boolean;
  volume: number;
  commentary: boolean;
  timeline: Timeline;
  lines: Line[];
}

export class ArenaPlayer {
  /** Browsers block sound until a click or key press. */
  unlocked = false;
  private crowd: HTMLAudioElement | null = null;
  private crowdOn = false;
  private crowdFailed = false;

  unlock(): void {
    this.unlocked = true;
    this.crowdFailed = false;
  }

  private synth(): SpeechSynth | null {
    try {
      const synth = window.speechSynthesis as SpeechSynth | undefined;
      if (!synth || typeof synth.speak !== "function") return null;
      return synth;
    } catch {
      return null;
    }
  }

  cancelSpeech(): void {
    try {
      this.synth()?.cancel();
    } catch {
      /* headless */
    }
  }

  private play(cue: SoundCue, volume: number): void {
    if (!this.unlocked || volume <= 0 || typeof Audio === "undefined") return;
    try {
      const clip = new Audio(SRC[cue]);
      clip.volume = Math.min(1, Math.max(0, volume));
      const pending = clip.play();
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch {
      /* headless or autoplay rejected */
    }
  }

  private setCrowd(on: boolean, volume: number): void {
    if (!on || !this.unlocked || volume <= 0 || typeof Audio === "undefined") {
      this.stopCrowd();
      return;
    }
    if (this.crowdFailed) return;
    try {
      if (!this.crowd) {
        this.crowd = new Audio("/assets/sfx/crowd-loop.ogg");
        this.crowd.loop = true;
      }
      this.crowd.volume = Math.min(1, volume * 0.28);
      if (!this.crowdOn) {
        this.crowdOn = true;
        const pending = this.crowd.play();
        if (pending && typeof pending.catch === "function") pending.catch(() => {
          this.crowdOn = false;
          this.crowdFailed = true;
        });
      }
    } catch {
      this.crowdOn = false;
      this.crowdFailed = true;
    }
  }

  stopCrowd(): void {
    this.crowdOn = false;
    try {
      this.crowd?.pause();
    } catch {
      /* headless */
    }
  }

  stop(): void {
    this.stopCrowd();
    this.cancelSpeech();
  }

  step(opts: AudioStep): void {
    if (opts.muted || !this.unlocked) {
      this.stop();
      return;
    }
    this.setCrowd(true, opts.volume);
    for (const cue of limitCues(cuesBetween(opts.timeline, opts.from, opts.to))) {
      this.play(cue, opts.volume * GAIN[cue]);
    }
    const synth = this.synth();
    if (!opts.commentary) {
      this.cancelSpeech();
      return;
    }
    const busy = !!(synth && (synth.speaking || synth.pending));
    const line = commentaryToSpeak(opts.lines, opts.from, opts.to, busy);
    if (line) speakCommentary(synth, line, opts.volume);
  }
}
