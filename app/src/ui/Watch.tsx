// The watch screen: 3D canvas, HUD, commentary, playback controls, result card.
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { SavedFight } from "../fight/runArenaFight";
import { fightFileName, serializeFight } from "../fight/savedFight";
import { buildTimeline, clockAt, vitalsAt, type Timeline } from "../playback/timeline";
import { buildCommentary, linesAt } from "../playback/commentary";
import { PlaybackStore, type Speed } from "../playback/store";
import { Arena } from "../scene/Arena";
import { Fighters } from "../scene/Fighters";
import { CameraRig, type CameraChoice } from "../scene/CameraRig";
import { rateFactorAt } from "../scene/choreo";
import { Hud } from "./Hud";
import { ResultCard } from "./ResultCard";
import { AudioControls } from "./AudioControls";
import { ArenaPlayer } from "../audio/player";
import { browserAudioStorage, readAudioPrefs, writeAudioPrefs, type AudioPrefs } from "../audio/prefs";

function Clock({ tl, store }: { tl: Timeline; store: PlaybackStore }) {
  useFrame((_, dt) => store.tick(dt * rateFactorAt(tl, store.T)), -1);
  return null;
}

function AudioClock({ store, step }: { store: PlaybackStore; step: (from: number, to: number) => void }) {
  const prev = useRef(store.T);
  const stepRef = useRef(step);
  stepRef.current = step;
  useFrame(() => {
    const to = store.T;
    const from = prev.current;
    if (to === from) return;
    prev.current = to;
    stepRef.current(from, to);
  });
  return null;
}

function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function download(fight: SavedFight) {
  const blob = new Blob([serializeFight(fight)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fightFileName(fight);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Watch({ fight, mode, onExit }: { fight: SavedFight; mode: "live" | "replay"; onExit: () => void }) {
  const tl = useMemo(() => buildTimeline(fight.log), [fight]);
  const lines = useMemo(
    () => (mode === "replay" && fight.commentary && fight.commentary.length > 0 ? fight.commentary : buildCommentary(tl)),
    [fight, mode, tl],
  );
  const store = useMemo(() => new PlaybackStore(tl), [tl]);
  const [camera, setCamera] = useState<CameraChoice>("auto");
  const [quality, setQuality] = useState<"high" | "low">("high");
  const [hideResult, setHideResult] = useState(false);
  const [liveCam, setLiveCam] = useState("wide");
  const [prefs, setPrefs] = useState<AudioPrefs>(() => readAudioPrefs(browserAudioStorage()));
  const player = useMemo(() => new ArenaPlayer(), []);
  useTicker(100);
  useEffect(() => {
    writeAudioPrefs(browserAudioStorage(), prefs);
  }, [prefs]);
  useEffect(() => {
    const unlock = () => player.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      player.stop();
    };
  }, [player]);
  const onAudio = (next: AudioPrefs) => {
    player.unlock();
    if (next.muted || !next.commentary) player.cancelSpeech();
    if (next.muted) player.stopCrowd();
    setPrefs(next);
  };
  useEffect(() => {
    // Dev-only handle for poking at playback from the console. Holds no keys.
    // Read-only inspection/seek hook used by the Playwright proof run (holds no keys).
    if (import.meta.env.DEV || new URLSearchParams(location.search).has("e2e")) (window as unknown as Record<string, unknown>).__arena = { store, tl };
  }, [store, tl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        store.playing = !store.playing;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const T = store.T;
  const showResult = T >= tl.resultStart + 9 && !hideResult; // after the referee raises the winner's hand
  const speeds: Speed[] = [1, 2, 4];

  return (
    <div className="watch" data-testid="watch">
      <Canvas
        key={quality}
        className="stage"
        shadows={quality === "high"}
        dpr={quality === "high" ? [1, 2] : 1}
        gl={{ antialias: quality === "high", preserveDrawingBuffer: true }}
        camera={{ fov: 42, near: 0.1, far: 120, position: [0, 5.6, 9.2] }}
      >
        <Suspense fallback={null}>
          <Clock tl={tl} store={store} />
          <AudioClock
            store={store}
            step={(from, to) => player.step({ from, to, muted: prefs.muted, volume: prefs.volume, commentary: prefs.commentary, timeline: tl, lines })}
          />
          <Arena tl={tl} store={store} quality={quality} />
          <Fighters tl={tl} store={store} quality={quality} />
          <CameraRig tl={tl} store={store} choice={camera} onCamera={setLiveCam} />
        </Suspense>
      </Canvas>

      <Hud fight={fight} vitals={vitalsAt(tl, T)} clock={clockAt(tl, T)} lines={linesAt(lines, T, 5)} />
      {mode === "replay" && (
        <div className="replay-badge" data-testid="replay-badge" role="status">Replay</div>
      )}
      {store.replay && (
        <div className="replay-banner" data-testid="replay-banner">
          ⟲ REPLAY · knockdown in slow motion
        </div>
      )}

      <div className="controls" data-testid="controls">
        <button type="button" onClick={() => (store.playing = !store.playing)} data-testid="play-pause">
          {store.playing ? "⏸ Pause" : "▶ Play"}
        </button>
        {speeds.map((s) => (
          <button type="button" key={s} className={store.speed === s ? "on" : ""} onClick={() => (store.speed = s)} data-testid={`speed-${s}`}>
            {s}x
          </button>
        ))}
        <button type="button" onClick={() => store.skipToResult()} data-testid="skip">
          ⏭ Skip to result
        </button>
        <label className="small">
          <input type="checkbox" checked={store.autoReplay} onChange={(e) => (store.autoReplay = e.target.checked)} /> KD replays
        </label>
        <span className="sep" />
        {(["auto", "wide", "ringside", "shoulder"] as const).map((c) => (
          <button type="button" key={c} className={camera === c ? "on" : ""} onClick={() => setCamera(c)} data-testid={`cam-${c}`}>
            {c === "auto" ? `🎥 Auto (${liveCam})` : c}
          </button>
        ))}
        <span className="sep" />
        <button type="button" onClick={() => setQuality(quality === "high" ? "low" : "high")} data-testid="quality">
          Quality: {quality}
        </button>
        <span className="sep" />
        <AudioControls prefs={prefs} onChange={onAudio} />
        <button type="button" onClick={() => download(fight)} data-testid="download-log">
          Download fight log
        </button>
        <button type="button" onClick={onExit}>
          New fight
        </button>
      </div>

      {showResult && (
        <ResultCard
          fight={fight}
          onClose={() => setHideResult(true)}
          onRestart={() => {
            store.restart();
            setHideResult(false);
          }}
          onDownload={() => download(fight)}
          onExit={onExit}
        />
      )}
    </div>
  );
}
