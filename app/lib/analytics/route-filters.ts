import { gte, inArray, lte, type SQL } from "drizzle-orm";
import { campaignsTable, clientsTable, transactionsTable } from "@workspace/db/schema";

export interface TransactionFilterParams {
  dateFrom?: string | null;
  dateTo?: string | null;
  clientIds?: number[];
  partnerIds?: number[];
  buyingHouseIds?: number[];
}

/**
 * Build the where-conditions shared by every transaction-based analytics route
 * (dashboard summary, profit-over-time, by-client, by-platform).
 *
 * `clientIds` / `partnerIds` match against `campaignsTable.clientId` /
 * `campaignsTable.platformId`; `buyingHouseIds` matches against
 * `clientsTable.buyingHouseId`. Callers are expected to join `campaignsTable`
 * (and `clientsTable`, for buying-house filtering) into their query so these
 * column references resolve.
 *
 * `inArray` is only added when the corresponding id list is non-empty, so a
 * request with no id filters produces exactly the same conditions as before
 * these filters existed (date range only, or none).
 */
export function buildTransactionConditions(params: TransactionFilterParams): SQL[] {
  const conditions: SQL[] = [];
  if (params.dateFrom) conditions.push(gte(transactionsTable.date, params.dateFrom));
  if (params.dateTo) conditions.push(lte(transactionsTable.date, params.dateTo));
  if (params.clientIds?.length) conditions.push(inArray(campaignsTable.clientId, params.clientIds));
  if (params.partnerIds?.length) conditions.push(inArray(campaignsTable.platformId, params.partnerIds));
  if (params.buyingHouseIds?.length) conditions.push(inArray(clientsTable.buyingHouseId, params.buyingHouseIds));
  return conditions;
}
