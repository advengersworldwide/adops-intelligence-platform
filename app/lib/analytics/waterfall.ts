import type { ComputeBillingResult } from "@/lib/compute-billing";

export interface WaterfallStage {
  key: "totalInvoice" | "lessWht" | "lessSst" | "lessBd" | "netReceivable" | "partnerPayout" | "netMargin";
  label: string;
  value: number;   // absolute magnitude for this stage
  kind: "start" | "decrease" | "subtotal" | "total";
}

/** Aggregate per-billing compute results into ordered leakage stages (PKR). */
export function buildWaterfall(results: ComputeBillingResult[]): WaterfallStage[] {
  const sum = (f: (r: ComputeBillingResult) => number) => results.reduce((s, r) => s + f(r), 0);
  return [
    { key: "totalInvoice", label: "Total Invoice", value: sum((r) => r.totalInvoice), kind: "start" },
    { key: "lessWht", label: "− Withholding", value: sum((r) => r.lessWht), kind: "decrease" },
    { key: "lessSst", label: "− Sales Tax", value: sum((r) => r.lessSst), kind: "decrease" },
    { key: "lessBd", label: "− Bulk Discount", value: sum((r) => r.lessBd), kind: "decrease" },
    { key: "netReceivable", label: "Net Receivable", value: sum((r) => r.netReceivable), kind: "subtotal" },
    { key: "partnerPayout", label: "− Partner Payout", value: sum((r) => r.netPayablePkr), kind: "decrease" },
    { key: "netMargin", label: "Net Margin", value: sum((r) => r.netMargin), kind: "total" },
  ];
}
