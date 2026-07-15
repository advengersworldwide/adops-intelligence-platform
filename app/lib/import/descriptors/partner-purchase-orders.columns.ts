// app/lib/import/descriptors/partner-purchase-orders.columns.ts
import type { ColumnSpec } from "../types";

export const partnerPurchaseOrdersColumns: ColumnSpec[] = [
  { key: "poReference", label: "PO Reference", required: true, aliases: ["ref", "poref", "group"], example: "PO-1", note: "Any label; groups the rows of one PO together (not stored)." },
  { key: "partnerName", label: "Partner", required: true, aliases: ["partner", "platform"], example: "Acme Media", note: "Must match an existing partner that has a PO code prefix." },
  { key: "clientPoCode", label: "Client PO Code", required: true, aliases: ["cpocode", "clientpo", "cpo"], example: "CPO-ACME-0126-0001", note: "Must match an existing client PO code." },
  { key: "startDate", label: "Start Date", required: true, aliases: ["start"], example: "2026-01-10", note: "YYYY-MM-DD." },
  { key: "endDate", label: "End Date", required: true, aliases: ["end"], example: "2026-02-10", note: "YYYY-MM-DD; on/after start date." },
  { key: "notes", label: "Notes", required: false, aliases: ["note"], example: "", note: "Optional free text (header-level)." },
  { key: "eventName", label: "Event", required: true, aliases: ["event"], example: "Install", note: "Must match an event defined on the client PO's client." },
  { key: "cacRate", label: "CAC Rate", required: true, aliases: ["cac", "rate"], example: "2.50", note: "Cost per event (number)." },
  { key: "eventCount", label: "Event Count", required: true, aliases: ["count", "events"], example: "1000", note: "Whole number of events." },
];

export const partnerPurchaseOrdersMeta = {
  type: "partner-purchase-orders",
  label: "Partner Purchase Orders",
  columns: partnerPurchaseOrdersColumns,
  sampleRows: [
    ["PO-1", "Acme Media", "CPO-ACME-0126-0001", "2026-01-10", "2026-02-10", "Q1 push", "Install", "2.50", "1000"],
    ["PO-1", "Acme Media", "CPO-ACME-0126-0001", "2026-01-10", "2026-02-10", "Q1 push", "Signup", "1.00", "500"],
    ["PO-2", "Beta Ads", "CPO-BETA-0126-0002", "2026-01-15", "2026-03-15", "", "Purchase", "5.00", "200"],
  ],
};