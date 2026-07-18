// app/lib/import/catalog.ts  — client-safe: no DB imports
import type { ColumnSpec } from "./types";
import { clientPurchaseOrdersMeta } from "./descriptors/client-purchase-orders.columns";
import { partnerPurchaseOrdersMeta } from "./descriptors/partner-purchase-orders.columns";

export interface CatalogEntry {
  type: string;
  label: string;
  columns: ColumnSpec[];
  sampleRows: string[][];
}

export const importCatalog: CatalogEntry[] = [clientPurchaseOrdersMeta, partnerPurchaseOrdersMeta];

export function getCatalogEntry(type: string): CatalogEntry | undefined {
  return importCatalog.find((e) => e.type === type);
}