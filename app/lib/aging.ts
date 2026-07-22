// Shared aging rule for receivable/payable due-date indicators.
// green while elapsed <= half the term, yellow past half, red once overdue.
// Once settled, aging stops: the pill goes green and reports how long settlement took.
export interface AgingInput {
  start: Date | null;
  termDays: number | null;
  now: Date;
  settled: boolean;
  settledAt?: Date | null;
}
export interface AgingResult {
  daysLeft: number | null;
  color: "green" | "yellow" | "red" | "neutral";
  overdue: boolean;
  daysToSettle: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeAging({ start, termDays, now, settled, settledAt }: AgingInput): AgingResult {
  if (settled) {
    // Aging halts on settlement; keep the days-to-settle metric when we know both dates.
    const daysToSettle = start && settledAt
      ? Math.max(0, Math.floor((settledAt.getTime() - start.getTime()) / DAY_MS))
      : null;
    return { daysLeft: null, color: "green", overdue: false, daysToSettle };
  }
  if (!start || termDays == null) {
    return { daysLeft: null, color: "neutral", overdue: false, daysToSettle: null };
  }
  const elapsed = Math.floor((now.getTime() - start.getTime()) / DAY_MS);
  const daysLeft = termDays - elapsed;
  const overdue = elapsed > termDays;
  const color = overdue ? "red" : elapsed > termDays / 2 ? "yellow" : "green";
  return { daysLeft, color, overdue, daysToSettle: null };
}
