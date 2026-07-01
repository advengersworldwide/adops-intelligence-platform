"use client";

import { forwardRef } from "react";
import type { PartnerPurchaseOrder } from "@workspace/api-client-react";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

const clauses = (paymentTerm: string | null | undefined): string[] => [
  `Payment terms: ${paymentTerm && paymentTerm.trim() ? paymentTerm : "as agreed with the partner"}`,
  "Please make sure final billing does not exceed the specified PO amount",
  "Billing will be processed based on the reporting methodology aligned",
  "All payments will be made via bank transfer to the specified bank account",
  "Please notify any discrepancies in the PO details and/or amount within 3 business days of receiving the PO",
  "This is a system generated document and does not require a physical signature",
];

export const PartnerInvoice = forwardRef<HTMLDivElement, { po: PartnerPurchaseOrder }>(
  function PartnerInvoice({ po }, ref) {
    const p = po.partner;
    const duration = `${fmt(po.startDate)} – ${fmt(po.endDate)}`;
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
            <h2 className="text-2xl font-bold tracking-wide" style={{ color: "#2f4a8b" }}>PURCHASE ORDER</h2>
            <p className="mt-1 text-sm">
              Invoice No: <span className="font-semibold">{po.code}</span>
            </p>
            <p className="text-sm">Date: {fmt(po.createdAt)}</p>
          </div>
        </div>

        {/* Partner (KYC) */}
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
            Partner
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
            <div><span style={{ color: "#6b7280" }}>Name:</span> {p?.name ?? "—"}</div>
            <div><span style={{ color: "#6b7280" }}>POC:</span> {p?.pocName ?? "—"}</div>
            <div><span style={{ color: "#6b7280" }}>Address:</span> {p?.address ?? "—"}</div>
            <div><span style={{ color: "#6b7280" }}>Phone:</span> {p?.pocNumber ?? p?.companyNumber ?? "—"}</div>
            <div><span style={{ color: "#6b7280" }}>Email:</span> {p?.pocEmail ?? p?.companyEmail ?? "—"}</div>
            <div><span style={{ color: "#6b7280" }}>NTN / STN:</span> {p?.ntnNumber ?? "—"} / {p?.salesTaxNumber ?? "—"}</div>
          </div>
        </div>

        {/* Line items */}
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: "#2f4a8b", color: "#ffffff", textTransform: "uppercase", fontSize: "11px" }}>
              {["Client", "Agency", "Duration", "Payable Event", "CAC Rate", "Event Count", "Budget"].map(
                (h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold" style={{ border: "1px solid #2f4a8b", verticalAlign: "middle" }}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {po.items.map((it) => (
              <tr key={it.id}>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{po.clientName}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{po.buyingHouseName ?? "—"}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{duration}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{it.eventName}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{it.cacRate}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{it.eventCount.toLocaleString()}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{money(it.lineBudget)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="px-3 py-2 text-right" colSpan={6} style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>
                TOTAL
              </td>
              <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{money(po.totalBudget)}</td>
            </tr>
          </tbody>
        </table>

        {/* Terms & clauses */}
        <ul className="mt-6 text-xs" style={{ color: "#4b5563", listStyleType: "disc", paddingLeft: "18px", lineHeight: "1.7" }}>
          {clauses(p?.paymentTermName).map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>

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
