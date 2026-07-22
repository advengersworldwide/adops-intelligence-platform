import { computeRow, type ComputeRowInput } from "@/lib/compute-row";

export interface AggRecord extends ComputeRowInput {
  clientId: number | null;
  platformId: number;
  buyingHouseId: number;
  period: string;
}
export interface Totals { revenue: number; cost: number; profit: number; marginPct: number }

export function aggregateTotals(records: AggRecord[]): Totals {
  let revenue = 0, cost = 0, profit = 0;
  for (const r of records) {
    const c = computeRow(r);
    revenue += c.receivablePkr; cost += c.totalPayablePkr; profit += c.netMarginPkr;
  }
  return { revenue, cost, profit, marginPct: revenue > 0 ? (profit / revenue) * 100 : 0 };
}

export function aggregateBy<K>(records: AggRecord[], keyFn: (r: AggRecord) => K): Map<K, Totals> {
  const groups = new Map<K, AggRecord[]>();
  for (const r of records) {
    const k = keyFn(r);
    const arr = groups.get(k);
    if (arr) arr.push(r); else groups.set(k, [r]);
  }
  const out = new Map<K, Totals>();
  for (const [k, recs] of groups) out.set(k, aggregateTotals(recs));
  return out;
}
