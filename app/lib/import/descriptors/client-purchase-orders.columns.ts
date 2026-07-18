// app/lib/import/descriptors/client-purchase-orders.columns.ts
import type { ColumnSpec } from "../types";

export const clientPurchaseOrdersColumns: ColumnSpec[] = [
  { key: "clientName", label: "Client Name", required: true, aliases: ["client"], example: "Acme Corp", note: "Must match an existing client that has a PO code prefix." },
  { key: "receiveDate", label: "Receive Date", required: false, aliases: ["received", "podate"], example: "2026-01-05", note: "YYYY-MM-DD; when the PO was received." },
  { key: "startDate", label: "Start Date", required: false, aliases: ["campaignstart"], example: "2026-01-10", note: "YYYY-MM-DD." },
  { key: "endDate", label: "End Date", required: false, aliases: ["campaignend"], example: "2026-02-10", note: "YYYY-MM-DD; on/after start date." },
];

export const clientPurchaseOrdersMeta = {
  type: "client-purchase-orders",
  label: "Client Purchase Orders",
  columns: clientPurchaseOrdersColumns,
  sampleRows: [
    ["Acme Corp", "2026-01-05", "2026-01-10", "2026-02-10"],
    ["Beta LLC", "2026-01-08", "2026-01-15", "2026-03-15"],
  ],
};