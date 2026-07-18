// app/lib/import/catalog.ts  — client-safe: no DB imports
import type { ColumnSpec } from "./types";
import { clientPurchaseOrdersMeta } from "./descriptors/client-purchase-orders.columns";
import { partnerPurchaseOrdersMeta } from "./descriptors/partner-purchase-orders.columns";
import { partnerBillsMeta } from "./descriptors/partner-bills.columns";
import { partnerPaymentsMeta } from "./descriptors/partner-payments.columns";

export interface CatalogEntry {
  type: string;
  label: string;
  columns: ColumnSpec[];
  sampleRows: string[][];
}

export const importCatalog: CatalogEntry[] = [clientPurchaseOrdersMeta, partnerPurchaseOrdersMeta, partnerBillsMeta, partnerPaymentsMeta];

export function getCatalogEntry(type: string): CatalogEntry | undefined {
  return importCatalog.find((e) => e.type === type);
}