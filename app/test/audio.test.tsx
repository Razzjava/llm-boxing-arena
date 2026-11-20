import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEMO_BUILDS, DEMO_CONTROLLERS, runFight } from "@llm-boxing-arena/engine";
import { buildCommentary } from "../src/playback/commentary";
import { buildTimeline } from "../src/playback/timeline";
import { commentaryToSpeak, cuesBetween, limitCues, type SoundCue } from "../src/audio/cues";
import { ArenaPlayer, speakCommentary, type SpeechSynth } from "../src/audio/player";
import { AUDIO_STORAGE_KEY, readAudioPrefs, writeAudioPrefs, type AudioPrefs } from "../src/audio/prefs";
import { AudioControls } from "../src/ui/AudioControls";
import { Hud } from "../src/ui/Hud";

afterEach(() => cleanup());

function memoryStorage(initial = ""): Storage {
  const data = new Map<string, string>();
  if (initial) data.set(AUDIO_STORAGE_KEY, initial);
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => data.delete(k),
    setItem: (k, v) => { data.set(k, v); },
  };
}

describe("audio preferences", () => {
  it("starts muted, remembers only mute, volume and commentary, and drops anything else", () => {
    const storage = memoryStorage();
    expect(readAudioPrefs(storage)).toEqual({ muted: true, volume: 0.7, commentary: true });
    expect(readAudioPrefs(null)).toEqual({ muted: true, volume: 0.7, commentary: true });

    writeAudioPrefs(storage, { muted: false, volume: 1.4, commentary: false });
    const raw = storage.getItem(AUDIO_STORAGE_KEY) as string;
    expect(JSON.parse(raw)).toEqual({ muted: false, volume: 1, commentary: false });
    expect(raw).not.toMatch(/sk-|key|token/i);

    writeAudioPrefs(storage, { muted: false, volume: Number.NaN, commentary: true, apiKey: "sk-secret" } as AudioPrefs);
    expect(readAudioPrefs(storage)).toEqual({ muted: false, volume: 0.7, commentary: true });
    expect(storage.getItem(AUDIO_STORAGE_KEY)).not.toContain("sk-secret");

    storage.setItem(AUDIO_STORAGE_KEY, "{not json");
    expect(readAudioPrefs(storage).muted).toBe(true);
  });

  it("the mute, volume and commentary controls report the next setting", () => {
    const seen: AudioPrefs[] = [];
    render(<AudioControls prefs={{ muted: true, volume: 0.7, commentary: true }} onChange={(next) => seen.push(next)} />);
    const mute = screen.getByTestId("audio-mute");
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    expect(mute.getAttribute("aria-label")).toBe("Unmute sound");
    fireEvent.click(mute);
    expect(seen.at(-1)?.muted).toBe(false);

    fireEvent.change(screen.getByTestId("audio-volume"), { target: { value: "40" } });
    expect(seen.at(-1)?.volume).toBeCloseTo(0.4);

    const commentary = screen.getByTestId("audio-commentary") as HTMLInputElement;
    expect(commentary.checked).toBe(true);
    fireEvent.click(commentary);
    expect(seen.at(-1)?.commentary).toBe(false);
  });
});

describe("fight audio cues", () => {
  it("a 10-round demo fight rings the bell, lands light and heavy punches, and counts a knockdown", async () => {
    const log = await runFight(DEMO_BUILDS.slugger, DEMO_BUILDS.swarmer, DEMO_CONTROLLERS.slugger, DEMO_CONTROLLERS.swarmer, 11);
    expect(log.rounds.length).toBeLessThanOrEqual(10);
    const tl = buildTimeline(log);
    const cues: SoundCue[] = [];
    for (let t = 0; t < tl.duration; t += 0.5) cues.push(...cuesBetween(tl, t, Math.min(tl.duration, t + 0.5)));
    expect(cues).toContain("bell");
    expect(cues).toContain("punch-light");
    expect(cues).toContain("punch-heavy");
    expect(cues).toContain("roar");
    expect(cues).toContain("count");
    expect(cuesBetween(tl, 0, 30)).toEqual([]);
    expect(limitCues(["punch-light", "punch-light", "punch-heavy", "bell", "roar"]).filter((c) => c.startsWith("punch"))).toHaveLength(2);
  });

  it("speaks one line and skips when the speech queue is busy or missing", () => {
    const lines = [
      { T: 1, text: "Round 1!", kind: "ref" as const },
      { T: 1.2, text: "Big shot!", kind: "big" as const },
    ];
    expect(commentaryToSpeak(lines, 0.5, 1.1, false)).toBe("Round 1!");
    expect(commentaryToSpeak(lines, 0.5, 1.5, false)).toBe("Big shot!");
    expect(commentaryToSpeak(lines, 0.5, 1.5, true)).toBeNull();
    expect(commentaryToSpeak(lines, 0, 20, false)).toBeNull();

    const spoken: { text: string; volume: number }[] = [];
    class Utterance {
      volume = 1;
      rate = 1;
      constructor(public text: string) {}
    }
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    const synth: SpeechSynth = {
      speaking: false,
      pending: false,
      speak: (u) => spoken.push({ text: u.text, volume: u.volume }),
      cancel: () => {},
    };
    expect(speakCommentary(synth, "Down he goes!", 0.5)).toBe("spoken");
    expect(spoken).toEqual([{ text: "Down he goes!", volume: 0.5 }]);
    synth.speaking = true;
    expect(speakCommentary(synth, "again", 1)).toBe("skipped");
    expect(speakCommentary(null, "again", 1)).toBe("unavailable");
    synth.speaking = false;
    vi.unstubAllGlobals();
    expect(speakCommentary(synth, "no utterance class", 1)).toBe("unavailable");
  });

  it("does not throw when speech and audio are unavailable", async () => {
    const log = await runFight(DEMO_BUILDS.outBoxer, DEMO_BUILDS.slugger, DEMO_CONTROLLERS.outBoxer, DEMO_CONTROLLERS.slugger, 3);
    const tl = buildTimeline(log);
    const player = new ArenaPlayer();
    const step = { from: 0, to: 0.4, muted: false, volume: 0.8, commentary: true, timeline: tl, lines: buildCommentary(tl) };
    expect(() => player.step(step)).not.toThrow();
    player.unlock();
    expect(() => player.step({ ...step, muted: true })).not.toThrow();
    expect(() => player.step(step)).not.toThrow();
    expect(() => player.stop()).not.toThrow();
  });
});

describe("HUD bar legend", () => {
  it("names head, body and stamina and exposes what each one does", async () => {
    const log = await runFight(DEMO_BUILDS.slugger, DEMO_BUILDS.swarmer, DEMO_CONTROLLERS.slugger, DEMO_CONTROLLERS.swarmer, 11);
    const fight = { app: "llm-boxing-arena" as const, version: 1 as const, meta: { a: { label: "Red" }, b: { label: "Blue" } }, log };
    const full = { head: 100, body: 90, stamina: 80, hurt: false, knockdowns: 0, cut: 0 };
    render(<Hud fight={fight} vitals={{ a: full, b: { ...full, head: 42 } }} clock={{ round: 4, label: "1:30" }} lines={[]} />);
    expect(screen.getAllByText("Head")).toHaveLength(2);
    expect(screen.getAllByText("Body")).toHaveLength(2);
    expect(screen.getAllByText("Stamina")).toHaveLength(2);
    const head = screen.getAllByTestId("bar-head");
    expect(head[0]?.getAttribute("aria-label")).toMatch(/Head: 100%.*knockdowns/);
    expect(head[0]?.getAttribute("title")).toMatch(/referee/);
    expect(head[1]?.getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getAllByTestId("bar-body")[0]?.getAttribute("aria-label")).toMatch(/stamina/);
    expect(screen.getAllByTestId("bar-stamina")[0]?.getAttribute("aria-label")).toMatch(/defence/);
    expect(screen.getByTestId("hud-clock").textContent).toContain("ROUND 4");
  });
});
