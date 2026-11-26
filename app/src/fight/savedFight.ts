// One serializer and one validator for a fight file. The file is the existing SavedFight
// wrapped around the engine FightLog: version, engine version, seed, builds, corner labels,
// plans, events, commentary and the result. No keys, headers or prompts.
import {
  ENGINE_VERSION, EXCHANGES_PER_ROUND, ROUNDS, checkBuild, replayFight, sanitizeActions, sanitizeTactic,
  type FightLog,
} from "@llm-boxing-arena/engine";
import { buildCommentary, type Line } from "../playback/commentary";
import { buildTimeline } from "../playback/timeline";
import type { CornerMeta, SavedFight } from "./runArenaFight";

export const FIGHT_FILE_VERSION = 1;
/** A seed-11 demo log is a few hundred kilobytes. Anything larger is not a fight file. */
export const MAX_FIGHT_FILE_CHARS = 1_500_000;
const MAX_COMMENTARY = 8_000;
const MAX_LINE = 400;
const MAX_EVENTS = 500;
const PROVIDERS = ["openai", "anthropic", "xai", "opencode"] as const;
const METHODS = new Set(["KO", "TKO", "UD", "SD", "MD", "draw", "TD"]);
const LINE_KINDS = new Set(["call", "big", "quote", "ref"]);
const FORBIDDEN_KEYS = new Set([
  "apikey", "api_key", "api-key", "authorization", "headers", "x-api-key",
  "proxy-authorization", "secret", "password", "bearer", "prompt", "prompts",
]);
const SECRET_TEXT = /\b(?:sk-ant-[\w*-]{6,}|sk-[\w*-]{8,}|xai-[\w*-]{6,}|Bearer\s+[A-Za-z0-9._-]{8,})/;

export function fightFileName(fight: SavedFight, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const slug = (name: string) => name.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "boxer";
  return `fight-${day}-${slug(fight.log.builds.a.name)}-vs-${slug(fight.log.builds.b.name)}.json`;
}

/** JSON for a completed fight. Aborted matches have no result and cannot be exported. */
export function serializeFight(fight: SavedFight, now = new Date()): string {
  if (!fight?.log?.result) throw new Error("Aborted matches have no result and cannot be exported.");
  const commentary = (fight.commentary && fight.commentary.length > 0 ? fight.commentary : buildCommentary(buildTimeline(fight.log))).map(cleanLine);
  const file = {
    app: "llm-boxing-arena" as const,
    version: FIGHT_FILE_VERSION as 1,
    engineVersion: ENGINE_VERSION,
    exportedAt: now.toISOString(),
    meta: { a: cleanMeta(fight.meta.a), b: cleanMeta(fight.meta.b) },
    commentary,
    log: redactTree(fight.log),
  };
  return JSON.stringify(file, null, 1);
}

/**
 * Validate a fight file and replay it. Throws a clear error for corrupt, wrong-version
 * or incompatible logs. On success the returned fight is the engine's replay, which
 * matches the file, and it is not recorded anywhere.
 */
export async function loadFight(text: string): Promise<SavedFight> {
  const fight = parseFightFile(text);
  let replayed: FightLog;
  try {
    replayed = await replayFight(fight.log);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Incompatible log: ${message}`);
  }
  if (JSON.stringify(replayed) !== JSON.stringify(fight.log)) {
    const versionNote = fight.engineVersion && fight.engineVersion !== ENGINE_VERSION
      ? ` The file was made by engine ${fight.engineVersion}; this arena is ${ENGINE_VERSION}.`
      : "";
    throw new Error(`Incompatible log: replaying this file does not match the recorded result.${versionNote}`);
  }
  const commentary = fight.commentary && fight.commentary.length > 0 ? fight.commentary : buildCommentary(buildTimeline(replayed));
  return { ...fight, log: replayed, commentary };
}

function parseFightFile(text: string): SavedFight {
  if (typeof text !== "string" || text.trim() === "") throw new Error("That file is empty.");
  if (text.length > MAX_FIGHT_FILE_CHARS) throw new Error("That file is too large to be a fight log.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!isRecord(parsed)) throw new Error("That doesn't look like an LLM Boxing Arena fight log.");
  assertNoSecrets(parsed);
  const bare = parsed.version === FIGHT_FILE_VERSION && Array.isArray(parsed.rounds) && parsed.log === undefined;
  if (!bare) {
    if (!("version" in parsed)) throw new Error("This fight log has no format version.");
    if (parsed.version !== FIGHT_FILE_VERSION) throw versionError(parsed.version);
    if (parsed.app !== undefined && parsed.app !== "llm-boxing-arena") {
      throw new Error("That doesn't look like an LLM Boxing Arena fight log.");
    }
  }
  const log = expectLog(bare ? parsed : parsed.log);
  return {
    app: "llm-boxing-arena",
    version: FIGHT_FILE_VERSION,
    engineVersion: bare ? undefined : expectEngineVersion(parsed.engineVersion),
    meta: expectMeta(bare ? undefined : parsed.meta, log),
    commentary: bare ? undefined : expectCommentary(parsed.commentary),
    log,
  };
}

function expectLog(raw: unknown): FightLog {
  if (!isRecord(raw)) throw new Error("This fight log is missing the fight data.");
  if (raw.version !== FIGHT_FILE_VERSION) throw versionError(raw.version);
  if (typeof raw.seed !== "number" || !Number.isInteger(raw.seed) || raw.seed < 0 || raw.seed > 1_000_000_000) {
    throw new Error("This fight log has a missing or invalid seed.");
  }
  expectBuilds(raw.builds);
  expectFixes(raw.buildFixes);
  expectRounds(raw.rounds);
  expectResult(raw.result);
  if (!isRecord(raw.finalState)) throw new Error("This fight log is missing the final state.");
  return raw as unknown as FightLog;
}

function expectBuilds(raw: unknown): void {
  if (!isRecord(raw)) throw new Error("This fight log is missing boxer builds.");
  for (const side of ["a", "b"] as const) {
    const problems = checkBuild(raw[side]);
    if (problems.length > 0) {
      const corner = side === "a" ? "Red" : "Blue";
      throw new Error(`${corner} corner's build cannot be replayed: ${problems.slice(0, 3).join("; ")}.`);
    }
  }
}

function expectFixes(raw: unknown): void {
  if (raw === undefined) return;
  if (!isRecord(raw) || !Array.isArray(raw.a) || !Array.isArray(raw.b)) throw new Error("This fight log has invalid build notes.");
  if (raw.a.length > 20 || raw.b.length > 20) throw new Error("This fight log has too many build notes.");
  for (const note of [...raw.a, ...raw.b]) {
    if (typeof note !== "string" || note.length > 200) throw new Error("This fight log has an invalid build note.");
  }
}

function expectRounds(raw: unknown): void {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("This fight log has no rounds.");
  if (raw.length > ROUNDS) throw new Error(`This fight log has ${raw.length} rounds; this arena plays at most ${ROUNDS}.`);
  raw.forEach((round, index) => {
    if (!isRecord(round)) throw new Error(`Round ${index + 1} is not valid.`);
    if (round.round !== index + 1) throw new Error(`Round ${index + 1} is numbered incorrectly.`);
    expectCorner(round.corner, index + 1);
    if (!Array.isArray(round.exchanges) || round.exchanges.length === 0 || round.exchanges.length > EXCHANGES_PER_ROUND) {
      throw new Error(`Round ${index + 1} has an invalid number of exchanges.`);
    }
    round.exchanges.forEach((exchange, exchangeIndex) => expectExchange(exchange, index + 1, exchangeIndex + 1));
    if (!Array.isArray(round.betweenRounds) || round.betweenRounds.length > 40) {
      throw new Error(`Round ${index + 1} is missing the between-rounds record.`);
    }
  });
}

function expectCorner(raw: unknown, round: number): void {
  if (!isRecord(raw)) throw new Error(`Round ${round} is missing corner tactics.`);
  for (const side of ["a", "b"] as const) expectTactic(raw[side], round, side);
}

function expectTactic(raw: unknown, round: number, side: "a" | "b"): void {
  const parsed = sanitizeTactic(raw);
  if (!parsed.ok) throw new Error(`Round ${round} ${side === "a" ? "red" : "blue"} corner tactic cannot be replayed: ${parsed.reason}.`);
  if (isRecord(raw)) expectTalk(raw.talk, `Round ${round} corner talk`);
}

function expectExchange(raw: unknown, round: number, n: number): void {
  const where = `Round ${round}, exchange ${n}`;
  if (!isRecord(raw)) throw new Error(`${where} is not valid.`);
  if (raw.exchange !== n) throw new Error(`${where} is numbered incorrectly.`);
  if (typeof raw.duration !== "number" || !Number.isFinite(raw.duration) || raw.duration < 0 || raw.duration > 180) {
    throw new Error(`${where} has an invalid duration.`);
  }
  if (!isRecord(raw.plans)) throw new Error(`${where} is missing both plans.`);
  for (const side of ["a", "b"] as const) expectPlan(raw.plans[side], where, side);
  if (!Array.isArray(raw.events) || raw.events.length > MAX_EVENTS) throw new Error(`${where} has an invalid event list.`);
  for (const event of raw.events) {
    if (!isRecord(event) || typeof event.type !== "string" || typeof event.t !== "number" || !Number.isFinite(event.t)) {
      throw new Error(`${where} has a corrupt event.`);
    }
  }
}

function expectPlan(raw: unknown, where: string, side: "a" | "b"): void {
  const corner = side === "a" ? "red" : "blue";
  const parsed = sanitizeActions(raw);
  if (!parsed.ok) throw new Error(`${where} ${corner} plan cannot be replayed: ${parsed.reason}.`);
  if (isRecord(raw)) expectTalk(raw.talk, `${where} talk`);
}

function expectTalk(talk: unknown, where: string): void {
  if (talk === undefined) return;
  if (typeof talk !== "string" || talk.length > MAX_LINE) throw new Error(`${where} is invalid.`);
}

function expectResult(raw: unknown): void {
  if (!isRecord(raw)) throw new Error("This fight log has no result, so it cannot be replayed.");
  if (raw.winner !== null && raw.winner !== "a" && raw.winner !== "b") throw new Error("This fight log has an invalid winner.");
  if (typeof raw.method !== "string" || !METHODS.has(raw.method)) throw new Error("This fight log has an invalid result.");
  if (typeof raw.round !== "number" || !Number.isInteger(raw.round) || raw.round < 1 || raw.round > ROUNDS) {
    throw new Error("This fight log has an invalid result round.");
  }
  if (typeof raw.time !== "number" || !Number.isFinite(raw.time) || raw.time < 0) throw new Error("This fight log has an invalid result time.");
  if (typeof raw.reason !== "string" || raw.reason.length > 400) throw new Error("This fight log has an invalid result reason.");
  if (!Array.isArray(raw.scorecards) || raw.scorecards.length > 3) throw new Error("This fight log has invalid scorecards.");
  for (const card of raw.scorecards) {
    if (!isRecord(card) || typeof card.judge !== "string" || typeof card.totalA !== "number" || typeof card.totalB !== "number") {
      throw new Error("This fight log has a corrupt scorecard.");
    }
    if (!Array.isArray(card.rounds) || card.rounds.length > ROUNDS) throw new Error("This fight log has a corrupt scorecard.");
  }
}

function expectMeta(raw: unknown, log: FightLog): SavedFight["meta"] {
  if (raw === undefined) return { a: { label: log.builds.a.name }, b: { label: log.builds.b.name } };
  if (!isRecord(raw)) throw new Error("This fight log has invalid corner labels.");
  return { a: expectCornerMeta(raw.a, "Red"), b: expectCornerMeta(raw.b, "Blue") };
}

function expectCornerMeta(raw: unknown, corner: string): CornerMeta {
  if (!isRecord(raw) || typeof raw.label !== "string" || raw.label.trim() === "" || raw.label.length > 160) {
    throw new Error(`${corner} corner's label is invalid.`);
  }
  const meta: CornerMeta = { label: raw.label };
  if (raw.provider !== undefined) {
    if (typeof raw.provider !== "string" || !(PROVIDERS as readonly string[]).includes(raw.provider)) {
      throw new Error(`${corner} corner's provider is invalid.`);
    }
    meta.provider = raw.provider;
  }
  if (raw.model !== undefined) {
    if (typeof raw.model !== "string" || raw.model.length === 0 || raw.model.length > 160) {
      throw new Error(`${corner} corner's model id is invalid.`);
    }
    meta.model = raw.model;
  }
  return meta;
}

function expectCommentary(raw: unknown): Line[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_COMMENTARY) throw new Error("This fight log's commentary is invalid.");
  return raw.map((line) => {
    if (!isRecord(line) || typeof line.T !== "number" || !Number.isFinite(line.T) || typeof line.text !== "string" || line.text.length > MAX_LINE) {
      throw new Error("This fight log's commentary is invalid.");
    }
    if (typeof line.kind !== "string" || !LINE_KINDS.has(line.kind)) throw new Error("This fight log's commentary is invalid.");
    if (line.side !== undefined && line.side !== "a" && line.side !== "b") throw new Error("This fight log's commentary is invalid.");
    const cleaned: Line = { T: line.T, text: line.text, kind: line.kind as Line["kind"] };
    if (line.side === "a" || line.side === "b") cleaned.side = line.side;
    return cleaned;
  });
}

function expectEngineVersion(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^\d+\.\d+\.\d+/.test(raw) || raw.length > 32) {
    throw new Error("This fight log has an invalid engine version.");
  }
  return raw;
}

function versionError(version: unknown): Error {
  const shown = typeof version === "number" || typeof version === "string" ? String(version) : "unknown";
  return new Error(`This fight log is version ${shown}, and this arena only plays version ${FIGHT_FILE_VERSION}.`);
}

function assertNoSecrets(value: unknown): void {
  if (typeof value === "string") {
    if (SECRET_TEXT.test(value)) throw new Error("This fight log contains something that looks like an API key and cannot be loaded.");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecrets(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, inner] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) throw new Error("This fight log includes a secret field and cannot be loaded.");
    assertNoSecrets(inner);
  }
}

function cleanMeta(meta: CornerMeta): CornerMeta {
  const out: CornerMeta = { label: redactLogText(meta.label).slice(0, 160) || "Corner" };
  if (meta.provider && (PROVIDERS as readonly string[]).includes(meta.provider)) out.provider = meta.provider;
  if (meta.model) out.model = redactLogText(meta.model).slice(0, 160);
  return out;
}

function cleanLine(line: Line): Line {
  const text = redactLogText(line.text).slice(0, MAX_LINE);
  return line.side ? { T: line.T, text, kind: line.kind, side: line.side } : { T: line.T, text, kind: line.kind };
}

function redactLogText(text: string): string {
  return text
    .replace(/\bsk-ant-[\w*-]{6,}\b/g, "[redacted]")
    .replace(/\bsk-[\w*-]{8,}\b/g, "[redacted]")
    .replace(/\bxai-[\w*-]{6,}\b/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/g, "Bearer [redacted]");
}

function redactTree(value: unknown): unknown {
  if (typeof value === "string") return redactLogText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map(redactTree);
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
    const next = redactTree(inner);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
