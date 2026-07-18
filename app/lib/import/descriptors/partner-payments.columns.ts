// app/lib/import/descriptors/partner-payments.columns.ts
import type { ColumnSpec } from "../types";

export const partnerPaymentsColumns: ColumnSpec[] = [
  { key: "partnerBillCode", label: "Partner Bill Code", required: true, aliases: ["billcode", "pbill", "partnerbill"], example: "PBILL-ACME-0126-0001", note: "Must match an existing partner bill; the partner is taken from the bill." },
  { key: "amount", label: "Amount (USD)", required: true, aliases: ["amt", "paid"], example: "500.00", note: "USD paid; cannot exceed the bill's remaining unpaid amount." },
  { key: "status", label: "Status", required: false, aliases: [], example: "settled", note: "pending (default) or settled." },
  { key: "mode", label: "Mode", required: false, aliases: ["method"], example: "wire", note: "Payment method, e.g. wire or cheque." },
  { key: "paymentDate", label: "Payment Date", required: false, aliases: ["date", "paidon"], example: "2026-02-05", note: "YYYY-MM-DD." },
  { key: "notes", label: "Notes", required: false, aliases: ["note"], example: "", note: "Optional free text." },
];

export const partnerPaymentsMeta = {
  type: "partner-payments",
  label: "Partner Payments",
  columns: partnerPaymentsColumns,
  sampleRows: [
    ["PBILL-ACME-0126-0001", "500.00", "settled", "wire", "2026-02-05", "First tranche"],
    ["PBILL-ACME-0126-0001", "1000.00", "pending", "wire", "2026-02-20", ""],
  ],
};
