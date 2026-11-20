import type { IncomingMessage, ServerResponse } from "node:http";
export const ROUTES: Record<string, { origin: string; allow: RegExp[] }>;
export const USER_AGENT: string;
export function createProxyHandler(options?: {
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
