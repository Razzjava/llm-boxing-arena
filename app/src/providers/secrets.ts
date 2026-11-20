// Error text from providers can echo part of a key (e.g. "Incorrect API key provided: sk-proj-****abcd").
// Everything shown in the UI or written to a fight log goes through this first.

const KEYISH = /\b(sk-ant-[\w*-]{6,}|sk-[\w*-]{6,}|xai-[\w*-]{6,}|key-[\w*-]{6,}|[A-Za-z0-9_*-]{32,})\b/g;

export function redactSecrets(message: string, ...secrets: string[]): string {
  let out = message;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("[redacted]");
  return out.replace(KEYISH, "[redacted]");
}
