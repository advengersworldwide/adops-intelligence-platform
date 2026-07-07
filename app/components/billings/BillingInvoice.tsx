"use client";

import { forwardRef } from "react";
import type { BillingDetail } from "@workspace/api-client-react";
import { computeBilling } from "@/lib/compute-billing";

const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

export const BillingInvoice = forwardRef<HTMLDivElement, { b: BillingDetail }>(
  function BillingInvoice({ b }, ref) {
    const totals = b.lines.reduce((acc, line) => {
      const c = computeBilling({
        events: line.items.map(it => ({ eventCount: it.eventCount, billableRate: it.billableRate, payoutRate: it.payoutRate })),
        forexSellingRate: b.forexSellingRate, forexBuyingRate: b.forexBuyingRate,
        remittanceTaxPct: b.remittanceTaxPct, salesTaxPct: b.salesTaxPct,
        withholdingTaxPct: b.withholdingTaxPct, bulkDiscountPct: b.bulkDiscountPct, whtApplied: b.whtApplied,
      });
      return {
        netTotalUsd: acc.netTotalUsd + c.netTotalUsd,
        netTotalPkr: acc.netTotalPkr + c.netTotalPkr,
        grossTotalPkr: acc.grossTotalPkr + c.grossTotalPkr,
        salesTax: acc.salesTax + c.salesTax,
        totalInvoice: acc.totalInvoice + c.totalInvoice,
      };
    }, { netTotalUsd: 0, netTotalPkr: 0, grossTotalPkr: 0, salesTax: 0, totalInvoice: 0 });

    return (
      <div
        ref={ref}
        className="mx-auto w-[800px] p-12"
        style={{
          backgroundColor: "#ffffff",
          color: "#1f2937",
          display: "flex",
          flexDirection: "column",
          minHeight: "1120px",
        }}
        data-testid="invoice-doc"
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-6" style={{ borderBottom: "2px solid #2f4a8b" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/advengers-logo.png" alt="Advengers" className="h-24 object-contain" />
          <div className="text-right">
            <h2 className="text-2xl font-bold tracking-wide" style={{ color: "#2f4a8b" }}>INVOICE</h2>
            <p className="mt-1 text-sm">
              Invoice No: <span className="font-semibold">{b.invoiceCode ?? "—"}</span>
            </p>
            <p className="text-sm">Date: {fmt(b.createdAt)}</p>
          </div>
        </div>

        {/* Bill To */}
        <div style={{ marginTop: "24px" }}>
          <div style={{
            backgroundColor: "#2f4a8b",
            color: "#ffffff",
            padding: "9px 12px",
            fontSize: "11px",
            lineHeight: "1",
            fontWeight: "600",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            width: "100%",
            boxSizing: "border-box",
          }}>
            Bill To
          </div>
          <div style={{
            marginTop: "8px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            columnGap: "32px",
            rowGap: "4px",
            paddingLeft: "12px",
            paddingRight: "12px",
            fontSize: "14px",
          }}>
            <div><span style={{ color: "#6b7280" }}>Client:</span> {b.clientName}</div>
            <div><span style={{ color: "#6b7280" }}>Agency:</span> {b.buyingHouseName ?? "—"}</div>
            <div><span style={{ color: "#6b7280" }}>Period:</span> {b.period}</div>
          </div>
        </div>

        {/* Line items */}
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: "#2f4a8b", color: "#ffffff", textTransform: "uppercase", fontSize: "11px" }}>
              {["Partner", "Agency", "Event", "Rate", "Count", "Line Total (USD)"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-semibold" style={{ border: "1px solid #2f4a8b", verticalAlign: "middle" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.lines.flatMap((line) => line.items.map((it) => (
              <tr key={`${line.id}-${it.id}`}>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{line.partnerName}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{b.buyingHouseName ?? "—"}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{it.eventName}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{it.billableRate}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{it.eventCount.toLocaleString()}</td>
                <td className="px-3 py-2 text-right" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{money(it.eventCount * it.billableRate)}</td>
              </tr>
            )))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 ml-auto text-sm" style={{ width: "320px" }}>
          <TotalRow label="Total of Events (USD)" value={`$${money(totals.netTotalUsd)}`} />
          <TotalRow label="Forex Rate" value={String(b.forexSellingRate)} />
          <TotalRow label="Net Total (PKR)" value={money(totals.netTotalPkr)} />
          <TotalRow label="Gross Total (PKR)" value={money(totals.grossTotalPkr)} />
          <TotalRow label={`Sales Tax @ ${b.salesTaxPct}%`} value={money(totals.salesTax)} />
          <TotalRow label="Total Invoice Amount" value={money(totals.totalInvoice)} bold />
        </div>

        {/* Notes — only rendered when the billing has notes */}
        {b.notes && b.notes.trim() && (
          <div className="mt-6 text-xs" style={{ color: "#4b5563" }}>
            <p className="font-semibold" style={{ color: "#2f4a8b" }}>Notes</p>
            <p className="mt-1" style={{ whiteSpace: "pre-wrap", lineHeight: "1.6" }}>{b.notes}</p>
          </div>
        )}

        <p className="mt-6 text-xs" style={{ color: "#4b5563" }}>
          This is a system generated document and does not require a physical signature.
        </p>

        {/* Spacer — pushes footer to bottom of page */}
        <div style={{ flex: 1 }} />

        {/* Footer — Advengers details */}
        <div className="pt-4 text-center text-xs" style={{ borderTop: "1px solid #d1d5db", color: "#6b7280" }}>
          <p className="font-semibold" style={{ color: "#2f4a8b" }}>Advengers</p>
          <p>
            Office #2, 1st Floor, Building #87-C, 11th Commercial Street, Phase II Extension, DHA,
            Karachi, 74700
          </p>
          <p>www.advengers.com.pk</p>
        </div>
      </div>
    );
  },
);

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      className="flex justify-between px-1 py-1"
      style={bold ? { fontWeight: 700, borderTop: "1px solid #d1d5db", marginTop: "2px", paddingTop: "6px" } : undefined}
    >
      <span>{label}</span>
      <span>PKR {value}</span>
    </div>
  );
}
