const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Inclusive [from,to] -> the equal-length window ending the day before `from`. */
export function priorRange(from: string, to: string): { from: string; to: string } {
  const start = new Date(from + "T00:00:00Z").getTime();
  const end = new Date(to + "T00:00:00Z").getTime();
  const lenDays = Math.round((end - start) / DAY) + 1;
  const priorTo = new Date(start - DAY);
  const priorFrom = new Date(priorTo.getTime() - (lenDays - 1) * DAY);
  return { from: iso(priorFrom), to: iso(priorTo) };
}
