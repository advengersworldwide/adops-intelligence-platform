// app/lib/import/descriptors/partner-bills.columns.ts
import type { ColumnSpec } from "../types";

export const partnerBillsColumns: ColumnSpec[] = [
  { key: "partnerName", label: "Partner", required: true, aliases: ["partner", "platform"], example: "Acme Media", note: "Must match an existing partner that has a code prefix." },
  { key: "amount", label: "Amount (USD)", required: true, aliases: ["amt", "total"], example: "1500.00", note: "The bill amount in USD." },
  { key: "partnerInvoiceNumber", label: "Invoice #", required: false, aliases: ["invoice", "invoiceno", "invoicenumber"], example: "INV-2026-014", note: "The partner's own invoice number; used to detect duplicates on re-import." },
  { key: "clientName", label: "Client", required: false, aliases: ["client"], example: "Beta LLC", note: "Optional; must match an existing client if provided." },
  { key: "partnerPoCode", label: "Partner PO Code", required: false, aliases: ["ppocode", "ppo", "partnerpo"], example: "PPO-ACME-0126-0001", note: "Optional; must match an existing partner PO code if provided." },
  { key: "dateReceived", label: "Date Received", required: false, aliases: ["received", "date"], example: "2026-01-20", note: "YYYY-MM-DD." },
  { key: "notes", label: "Notes", required: false, aliases: ["note"], example: "", note: "Optional free text." },
];

export const partnerBillsMeta = {
  type: "partner-bills",
  label: "Partner Bills",
  columns: partnerBillsColumns,
  sampleRows: [
    ["Acme Media", "1500.00", "INV-2026-014", "Beta LLC", "PPO-ACME-0126-0001", "2026-01-20", "January services"],
    ["Beta Ads", "800.50", "5567", "", "", "2026-01-22", ""],
  ],
};