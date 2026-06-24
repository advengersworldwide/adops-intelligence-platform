export type PoPrefix = "CPO" | "PPO";

/** @param seq Positive integer >= 1. Values < 1 or non-integer produce malformed codes. */
export function formatPoCode(prefix: PoPrefix, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}
