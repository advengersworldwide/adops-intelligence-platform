// app/lib/import/catalog.ts  — client-safe: no DB imports
import type { ColumnSpec } from "./types";
import { clientBillingSummaryMeta } from "./descriptors/client-billing-summary.columns";
import { partnerBillsMeta } from "./descriptors/partner-bills.columns";

export interface CatalogEntry {
  type: string;
  label: string;
  columns: ColumnSpec[];
  sampleRows: string[][];
  /** Which entity must be picked before uploading: gates the file drop-zone. */
  scope: "client" | "partner";
}

// Bulk upload offers exactly two sheets (client-scoped and partner-scoped).
export const importCatalog: CatalogEntry[] = [
  { ...clientBillingSummaryMeta, scope: "client" },
  { ...partnerBillsMeta, scope: "partner" },
];

export function getCatalogEntry(type: string): CatalogEntry | undefined {
  return importCatalog.find((e) => e.type === type);
}
