/** Percent change of current vs prior. Null when prior is 0 (growth undefined). */
export function percentDelta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

/** profit / revenue as a percent, 0 when revenue is 0. */
export function marginPct(profit: number, revenue: number): number {
  return revenue > 0 ? (profit / revenue) * 100 : 0;
}
