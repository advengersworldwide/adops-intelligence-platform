/**
 * Given payment installments (amount + date), returns the date at which the
 * cumulative amount first covers `target` (the amount owed), or null if it never
 * does. Installments are applied oldest-first. Used to derive when a bill became
 * settled without storing a settled_at column.
 */
export function settledDate(items: { amt: number; when: Date }[], target: number): Date | null {
  if (!(target > 0)) return null;
  const sorted = [...items].sort((a, b) => a.when.getTime() - b.when.getTime());
  let cum = 0;
  for (const it of sorted) {
    cum += it.amt;
    if (cum >= target - 0.01) return it.when;
  }
  return null;
}
