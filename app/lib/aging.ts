// Shared aging rule for receivable/payable due-date indicators.
// green while elapsed <= half the term, yellow past half, red once overdue.
export interface AgingInput {
  start: Date | null;
  termDays: number | null;
  now: Date;
  settled: boolean;
}
export interface AgingResult {
  daysLeft: number | null;
  color: "green" | "yellow" | "red" | "neutral";
  overdue: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeAging({ start, termDays, now, settled }: AgingInput): AgingResult {
  if (settled || !start || termDays == null) {
    return { daysLeft: null, color: "neutral", overdue: false };
  }
  const elapsed = Math.floor((now.getTime() - start.getTime()) / DAY_MS);
  const daysLeft = termDays - elapsed;
  const overdue = elapsed > termDays;
  const color = overdue ? "red" : elapsed > termDays / 2 ? "yellow" : "green";
  return { daysLeft, color, overdue };
}
