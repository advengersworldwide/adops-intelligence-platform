// Pure PPO (partner purchase order) burn-down pacing calculation.
// Compares actual spend (consumed) against an "ideal to date" linear pace across
// the PO window (startDate..endDate) and projects a naive exhaustion date at the
// current daily burn rate. UTC-based day math throughout for deterministic tests.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PaceResult {
  totalDays: number;
  elapsedDays: number;
  idealToDate: number; // budget * elapsed/total (clamped)
  overpacePct: number; // (consumed - idealToDate)/idealToDate * 100; 0 when idealToDate<=0
  pctConsumed: number; // consumed/budget * 100; 0 when budget<=0
  projectedExhaustion: string | null; // ISO yyyy-mm-dd when consumed>0 & elapsed>0, else null
}

function toUtcDate(d: string | Date): Date {
  return typeof d === "string" ? new Date(`${d}T00:00:00Z`) : d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export function pace(
  consumed: number,
  budget: number,
  start: string | Date,
  end: string | Date,
  asOf: Date,
): PaceResult {
  const startDate = toUtcDate(start);
  const endDate = toUtcDate(end);

  const totalDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS));
  const elapsedDays = clamp(Math.round((asOf.getTime() - startDate.getTime()) / DAY_MS), 0, totalDays);

  const idealToDate = (budget * elapsedDays) / totalDays;
  const overpacePct = idealToDate > 0 ? ((consumed - idealToDate) / idealToDate) * 100 : 0;
  const pctConsumed = budget > 0 ? (consumed / budget) * 100 : 0;

  let projectedExhaustion: string | null = null;
  if (consumed > 0 && elapsedDays > 0) {
    const dailyRate = consumed / elapsedDays;
    const daysToBudget = budget / dailyRate;
    projectedExhaustion = toIsoDate(new Date(startDate.getTime() + daysToBudget * DAY_MS));
  }

  return { totalDays, elapsedDays, idealToDate, overpacePct, pctConsumed, projectedExhaustion };
}
