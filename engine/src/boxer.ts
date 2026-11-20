// Boxer builds: validation and repair of whatever an LLM sends back.
import type { BoxerBuild, Stance, Stats, Style } from "./types.js";

export const STAT_KEYS = ["power", "speed", "accuracy", "defence", "chin", "stamina"] as const;
export const STAT_TOTAL = 30;
export const STAT_MIN = 1;
export const STAT_MAX = 10;
export const STYLES: readonly Style[] = ["out-boxer", "swarmer", "slugger", "counter-puncher"];
export const STANCES: readonly Stance[] = ["orthodox", "southpaw"];
const NAME_MAX = 24;

export const DEFAULT_BUILD: BoxerBuild = {
  name: "Journeyman",
  nickname: "The Default",
  stance: "orthodox",
  style: "out-boxer",
  stats: { power: 5, speed: 5, accuracy: 5, defence: 5, chin: 5, stamina: 5 },
};

/** Strict check. Returns a list of problems; empty means the build is legal as-is. */
export function checkBuild(build: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(build)) return ["build is not an object"];
  if (typeof build.name !== "string" || cleanText(build.name, NAME_MAX) === "") errors.push("name missing");
  if (!STANCES.includes(build.stance as Stance)) errors.push("stance must be orthodox or southpaw");
  if (!STYLES.includes(build.style as Style)) errors.push(`style must be one of ${STYLES.join(", ")}`);
  const stats = build.stats;
  if (!isObject(stats)) return [...errors, "stats missing"];
  let total = 0;
  for (const key of STAT_KEYS) {
    const v = stats[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < STAT_MIN || v > STAT_MAX) {
      errors.push(`${key} must be a whole number 1-10`);
    } else total += v;
  }
  if (errors.length === 0 && total !== STAT_TOTAL) errors.push(`stats must total ${STAT_TOTAL} (got ${total})`);
  return errors;
}

export interface NormalizedBuild {
  build: BoxerBuild;
  /** What was changed, for the UI ("speed clamped to 10", ...). */
  fixes: string[];
  /** True when the input was unusable and the default fighter was used. */
  usedDefault: boolean;
}

/**
 * Repair an untrusted build: clamp stats to 1-10, rescale to total 30, fill bad text fields.
 * Falls back to DEFAULT_BUILD if there is nothing usable.
 */
export function normalizeBuild(raw: unknown, fallbackName = DEFAULT_BUILD.name): NormalizedBuild {
  if (!isObject(raw) || !isObject(raw.stats)) {
    return { build: { ...DEFAULT_BUILD, name: fallbackName, stats: { ...DEFAULT_BUILD.stats } }, fixes: ["unusable build, default fighter used"], usedDefault: true };
  }
  const fixes: string[] = [];
  const name = typeof raw.name === "string" ? cleanText(raw.name, NAME_MAX) : "";
  if (name === "") fixes.push("name missing, default used");
  const nickname = typeof raw.nickname === "string" ? cleanText(raw.nickname, NAME_MAX) : "";
  const stanceText = String(raw.stance ?? "").toLowerCase().trim();
  const stance: Stance = STANCES.includes(stanceText as Stance) ? (stanceText as Stance) : "orthodox";
  if (stance !== stanceText) fixes.push("stance defaulted to orthodox");
  const styleText = String(raw.style ?? "").toLowerCase().trim().replace(/[\s_]+/g, "-");
  const style: Style = STYLES.includes(styleText as Style) ? (styleText as Style) : "out-boxer";
  if (style !== styleText) fixes.push("style defaulted to out-boxer");

  const { stats, fixes: statFixes } = repairStats(raw.stats);
  return {
    build: { name: name || fallbackName, nickname, stance, style, stats },
    fixes: [...fixes, ...statFixes],
    usedDefault: false,
  };
}

function repairStats(raw: Record<string, unknown>): { stats: Stats; fixes: string[] } {
  const fixes: string[] = [];
  const values = STAT_KEYS.map((key) => {
    const n = Number(raw[key]);
    if (!Number.isFinite(n)) {
      fixes.push(`${key} missing, set to 5`);
      return 5;
    }
    const clamped = Math.min(STAT_MAX, Math.max(STAT_MIN, Math.round(n)));
    if (clamped !== n) fixes.push(`${key} adjusted from ${n} to ${clamped}`);
    return clamped;
  });

  let total = values.reduce((s, v) => s + v, 0);
  if (total !== STAT_TOTAL) {
    fixes.push(`stats totalled ${total}, rescaled to ${STAT_TOTAL}`);
    // Scale proportionally, then nudge one point at a time until the total is exact.
    for (let i = 0; i < values.length; i++) {
      values[i] = Math.min(STAT_MAX, Math.max(STAT_MIN, Math.round(((values[i] as number) * STAT_TOTAL) / total)));
    }
    total = values.reduce((s, v) => s + v, 0);
    while (total !== STAT_TOTAL) {
      const step = total < STAT_TOTAL ? 1 : -1;
      // Add to the lowest stat that can grow, or take from the highest that can shrink (first one wins ties).
      let idx = -1;
      for (let i = 0; i < values.length; i++) {
        const v = values[i] as number;
        const ok = step > 0 ? v < STAT_MAX : v > STAT_MIN;
        if (!ok) continue;
        if (idx === -1) idx = i;
        else if (step > 0 ? v < (values[idx] as number) : v > (values[idx] as number)) idx = i;
      }
      values[idx] = (values[idx] as number) + step;
      total += step;
    }
  }
  const stats = Object.fromEntries(STAT_KEYS.map((k, i) => [k, values[i]])) as unknown as Stats;
  return { stats, fixes };
}

/** Strip control characters and markup-ish brackets, collapse spaces, cap length. */
function cleanText(text: string, max: number): string {
  return text
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
