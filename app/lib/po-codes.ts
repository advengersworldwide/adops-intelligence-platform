export type PoPrefix = "CPO" | "PPO";

export function formatPoCode(prefix: PoPrefix, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}
