export type RevenueEngine = "media" | "performance" | "combined";
export type FinancialStatus = "paid" | "pending" | "overdue" | "dispute";

export interface AnalyticsFilters {
  dateFrom: string;
  dateTo: string;
  engine: RevenueEngine;
  clientIds: number[];
  partnerIds: number[];
  buyingHouseIds: number[];
  costModelId: number | null;
  poId: number | null;
  status: FinancialStatus | null;
  compare: boolean;
}

/** Build the query object for the generated analytics hooks, omitting empties. */
export function buildAnalyticsParams(f: AnalyticsFilters): Record<string, string | boolean> {
  const p: Record<string, string | boolean> = {
    dateFrom: f.dateFrom, dateTo: f.dateTo, engine: f.engine, compare: f.compare,
  };
  if (f.clientIds.length) p.clientIds = f.clientIds.join(",");
  if (f.partnerIds.length) p.partnerIds = f.partnerIds.join(",");
  if (f.buyingHouseIds.length) p.buyingHouseIds = f.buyingHouseIds.join(",");
  if (f.costModelId != null) p.costModelId = String(f.costModelId);
  if (f.poId != null) p.poId = String(f.poId);
  if (f.status != null) p.status = f.status;
  return p;
}
