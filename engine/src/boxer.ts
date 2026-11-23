// Boxer builds: strict checks. An illegal model build aborts the match; nothing is repaired or replaced.
import type { BoxerBuild, Stance, Stats, Style } from "./types.js";

export const STAT_KEYS = ["power", "speed", "accuracy", "defence", "chin", "stamina"] as const;
export const STAT_TOTAL = 30;
export const STAT_MIN = 1;
export const STAT_MAX = 10;
export const STYLES: readonly Style[] = ["out-boxer", "swarmer", "slugger", "counter-puncher"];
export const STANCES: readonly Stance[] = ["orthodox", "southpaw"];
const NAME_MAX = 24;

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

export type AcceptedBuild = { ok: true; build: BoxerBuild } | { ok: false; reason: string };

/**
 * Accept a build that already passes {@link checkBuild}. Display text is cleaned; stats are copied
 * unchanged. Anything illegal is an unusable response, not a default fighter.
 */
export function acceptBuild(raw: unknown): AcceptedBuild {
  const errors = checkBuild(raw);
  if (errors.length > 0 || !isObject(raw) || !isObject(raw.stats)) {
    const detail = errors.slice(0, 3).join("; ") || "not a boxer build";
    return { ok: false, reason: `unusable response: ${detail}` };
  }
  const stats = raw.stats as unknown as Stats;
  const nickname = typeof raw.nickname === "string" ? cleanText(raw.nickname, NAME_MAX) : "";
  return {
    ok: true,
    build: {
      name: cleanText(String(raw.name), NAME_MAX),
      nickname,
      stance: raw.stance as Stance,
      style: raw.style as Style,
      stats: {
        power: stats.power,
        speed: stats.speed,
        accuracy: stats.accuracy,
        defence: stats.defence,
        chin: stats.chin,
        stamina: stats.stamina,
      },
    },
  };
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
