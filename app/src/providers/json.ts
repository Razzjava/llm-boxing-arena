// Pull a JSON object out of whatever a model replied with: bare JSON, fenced blocks,
// prose around it, <think> blocks, trailing commas. Returns null if nothing usable.

export function extractJson(text: unknown, preferKeys: string[] = []): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const candidates: Record<string, unknown>[] = [];

  const whole = tryParse(cleaned);
  if (whole) return whole;

  for (const m of cleaned.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) {
    const obj = tryParse(m[1] ?? "");
    if (obj) candidates.push(obj);
  }
  for (const block of balancedObjects(cleaned)) {
    const obj = tryParse(block);
    if (obj) candidates.push(obj);
  }
  if (candidates.length === 0) return null;
  if (preferKeys.length > 0) {
    const hit = candidates.find((c) => preferKeys.some((k) => k in c));
    if (hit) return hit;
  }
  return candidates[candidates.length - 1] ?? null;
}

function tryParse(s: string): Record<string, unknown> | null {
  const attempts = [s.trim(), s.trim().replace(/,\s*([}\]])/g, "$1")];
  for (const a of attempts) {
    if (!a.startsWith("{")) continue;
    try {
      const v: unknown = JSON.parse(a);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // try the next repair
    }
  }
  return null;
}

/** Every top-level {...} span, string-aware so braces inside strings don't confuse it. */
function balancedObjects(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) out.push(s.slice(start, i + 1));
    }
  }
  return out;
}
