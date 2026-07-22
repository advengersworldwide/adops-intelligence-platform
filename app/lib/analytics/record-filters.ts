import { gte, inArray, lte, type SQL } from "drizzle-orm";
import { billingRecordsTable } from "@workspace/db/schema";

export function monthOf(d: string | null | undefined): string | null {
  return d ? d.slice(0, 7) : null;
}

export interface RecordFilterParams {
  dateFrom?: string | null;
  dateTo?: string | null;
  clientIds?: number[];
  partnerIds?: number[];
  buyingHouseIds?: number[];
}

export function buildRecordConditions(p: RecordFilterParams): SQL[] {
  const conditions: SQL[] = [];
  const from = monthOf(p.dateFrom);
  const to = monthOf(p.dateTo);
  if (from) conditions.push(gte(billingRecordsTable.period, from));
  if (to) conditions.push(lte(billingRecordsTable.period, to));
  if (p.clientIds?.length) conditions.push(inArray(billingRecordsTable.clientId, p.clientIds));
  if (p.partnerIds?.length) conditions.push(inArray(billingRecordsTable.platformId, p.partnerIds));
  if (p.buyingHouseIds?.length) conditions.push(inArray(billingRecordsTable.buyingHouseId, p.buyingHouseIds));
  return conditions;
}
