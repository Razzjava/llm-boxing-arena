import type { AudioPrefs } from "../audio/prefs";

export function AudioControls({ prefs, onChange }: { prefs: AudioPrefs; onChange: (next: AudioPrefs) => void }) {
  return (
    <>
      <button
        type="button"
        className={prefs.muted ? "" : "on"}
        data-testid="audio-mute"
        aria-pressed={!prefs.muted}
        aria-label={prefs.muted ? "Unmute sound" : "Mute sound"}
        onClick={() => onChange({ ...prefs, muted: !prefs.muted })}
      >
        {prefs.muted ? "🔇 Sound off" : "🔊 Sound on"}
      </button>
      <label className="small audio-volume">
        Volume
        <input
          data-testid="audio-volume"
          type="range"
          min={0}
          max={100}
          step={5}
          aria-label="Sound volume"
          value={Math.round(prefs.volume * 100)}
          onChange={(e) => onChange({ ...prefs, volume: Number(e.target.value) / 100 })}
        />
      </label>
      <label className="small">
        <input
          data-testid="audio-commentary"
          type="checkbox"
          checked={prefs.commentary}
          aria-label="Spoken commentary"
          onChange={(e) => onChange({ ...prefs, commentary: e.target.checked })}
        />
        Spoken commentary
      </label>
    </>
  );
}
