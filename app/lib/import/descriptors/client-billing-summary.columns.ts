// app/lib/import/descriptors/client-billing-summary.columns.ts
import type { ColumnSpec } from "../types";

export const clientBillingSummaryColumns: ColumnSpec[] = [
  { key: "clientName", label: "Client", required: true, aliases: ["client"], example: "Beta LLC", note: "Must match the client selected above." },
  { key: "partnerName", label: "Partner", required: true, aliases: ["partner", "platform"], example: "Acme Media", note: "Must match an existing partner." },
  { key: "costModel", label: "Cost Model", required: true, aliases: ["costmodel", "model"], example: "CPI Standard", note: "Must match an existing cost model." },
  { key: "period", label: "Period", required: true, aliases: ["month"], example: "2026-01", note: "YYYY-MM." },
  { key: "appsflyerPins", label: "AppsFlyer PINs", required: true, aliases: ["appsflyer", "pins", "afpins"], example: "1200", note: "Whole number." },
  { key: "fraudPins", label: "Fraud PINs", required: true, aliases: ["fraud"], example: "80", note: "Whole number; subtracted from AppsFlyer PINs." },
  { key: "payoutRate", label: "Payout Rate (USD)", required: true, aliases: ["payout", "rate"], example: "0.45", note: "USD per valid PIN paid to the partner." },
  { key: "marginPct", label: "Margin %", required: true, aliases: ["margin"], example: "20", note: "Your margin percentage." },
  { key: "forexSellingRate", label: "Forex Selling", required: true, aliases: ["forexselling", "sellingrate"], example: "278", note: "USD→PKR selling rate (client side)." },
  { key: "forexBuyingRate", label: "Forex Buying", required: true, aliases: ["forexbuying", "buyingrate"], example: "276", note: "USD→PKR buying rate (partner side)." },
];

export const clientBillingSummaryMeta = {
  type: "client-billing-summary",
  label: "Client Billing Summary",
  columns: clientBillingSummaryColumns,
  sampleRows: [
    ["Beta LLC", "Acme Media", "CPI Standard", "2026-01", "1200", "80", "0.45", "20", "278", "276"],
    ["Beta LLC", "Trade Desk", "CPI Standard", "2026-01", "900", "30", "0.50", "18", "278", "276"],
  ],
};
