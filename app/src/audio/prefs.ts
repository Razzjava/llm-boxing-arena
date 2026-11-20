// Viewer sound preferences. This is the only module that reads or writes them.
// API keys are never written here: the saved object is exactly these three fields.

export interface AudioPrefs {
  muted: boolean;
  volume: number;
  commentary: boolean;
}

export const AUDIO_STORAGE_KEY = "arena-audio";

/** Sound stays off until the viewer turns it on, so autoplay rules are satisfied. */
export const DEFAULT_AUDIO: AudioPrefs = { muted: true, volume: 0.7, commentary: true };

export function clampVolume(value: unknown): number {
  const n = typeof value === "number" ? value : DEFAULT_AUDIO.volume;
  if (!Number.isFinite(n)) return DEFAULT_AUDIO.volume;
  return Math.min(1, Math.max(0, n));
}

export function readAudioPrefs(storage: Pick<Storage, "getItem"> | null): AudioPrefs {
  if (!storage) return { ...DEFAULT_AUDIO };
  try {
    const raw = storage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUDIO };
    const parsed = JSON.parse(raw) as Partial<AudioPrefs>;
    return {
      muted: typeof parsed.muted === "boolean" ? parsed.muted : DEFAULT_AUDIO.muted,
      volume: clampVolume(parsed.volume),
      commentary: typeof parsed.commentary === "boolean" ? parsed.commentary : DEFAULT_AUDIO.commentary,
    };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

export function writeAudioPrefs(storage: Pick<Storage, "setItem"> | null, prefs: AudioPrefs): void {
  if (!storage) return;
  const safe: AudioPrefs = {
    muted: !!prefs.muted,
    volume: clampVolume(prefs.volume),
    commentary: !!prefs.commentary,
  };
  storage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(safe));
}

/** localStorage when the browser allows it. Null in private mode and in tests without it. */
export function browserAudioStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
