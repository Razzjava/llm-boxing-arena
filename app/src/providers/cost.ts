// Rough cost of one fight for one corner, from a model list's published prices (USD per 1M tokens).
// One fight = 1 build call + one corner call per round + up to one call per exchange.
import { EXCHANGES_PER_ROUND, ROUNDS } from "@llm-boxing-arena/engine";

export const CALLS_PER_FIGHT = 1 + ROUNDS + ROUNDS * EXCHANGES_PER_ROUND;
export const INPUT_TOKENS_PER_CALL = 1100;
export const OUTPUT_TOKENS_PER_CALL = 250; // allows a little reasoning

export function estimateFightCost(inputPrice?: number, outputPrice?: number): number | null {
  if (inputPrice === undefined || outputPrice === undefined) return null;
  const input = (CALLS_PER_FIGHT * INPUT_TOKENS_PER_CALL * inputPrice) / 1e6;
  const output = (CALLS_PER_FIGHT * OUTPUT_TOKENS_PER_CALL * outputPrice) / 1e6;
  return input + output;
}

export function formatCost(cost: number | null): string {
  if (cost === null) return "price n/a";
  if (cost === 0) return "free";
  if (cost < 0.01) return "<$0.01/fight";
  return `~$${cost < 1 ? cost.toFixed(2) : cost.toFixed(1)}/fight`;
}

export function formatContext(tokens?: number): string {
  if (!tokens) return "";
  return tokens >= 1_000_000 ? `${+(tokens / 1_000_000).toFixed(1)}M ctx` : `${Math.round(tokens / 1000)}k ctx`;
}
