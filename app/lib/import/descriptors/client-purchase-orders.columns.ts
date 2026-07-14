// app/lib/import/descriptors/client-purchase-orders.columns.ts
import type { ColumnSpec } from "../types";

export const clientPurchaseOrdersColumns: ColumnSpec[] = [
  { key: "clientName", label: "Client Name", required: true, aliases: ["client"], example: "Acme Corp" },
  { key: "receiveDate", label: "Receive Date", required: false, aliases: ["received", "podate"], example: "2026-01-05" },
  { key: "startDate", label: "Start Date", required: false, aliases: ["campaignstart"], example: "2026-01-10" },
  { key: "endDate", label: "End Date", required: false, aliases: ["campaignend"], example: "2026-02-10" },
];

export const clientPurchaseOrdersMeta = {
  type: "client-purchase-orders",
  label: "Client Purchase Orders",
  columns: clientPurchaseOrdersColumns,
};
