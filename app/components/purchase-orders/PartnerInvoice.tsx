"use client";

import { forwardRef } from "react";
import type { PartnerPurchaseOrder } from "@workspace/api-client-react";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

const CLAUSE = "[Clause text to be provided by Advengers.]";

export const PartnerInvoice = forwardRef<HTMLDivElement, { po: PartnerPurchaseOrder }>(
  function PartnerInvoice({ po }, ref) {
    const p = po.partner;
    const duration = `${fmt(po.startDate)} – ${fmt(po.endDate)}`;
    return (
      <div ref={ref} className="mx-auto w-[800px] p-12" style={{ backgroundColor: "#ffffff", color: "#1f2937" }} data-testid="invoice-doc">
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

        {/* Vendor (partner KYC) */}
        <div className="mt-6">
          <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide" style={{ backgroundColor: "#2f4a8b", color: "#ffffff" }}>
            PARTNER
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <div>
              <span style={{ color: "#6b7280" }}>Name:</span> {p?.name ?? "—"}
            </div>
            <div>
              <span style={{ color: "#6b7280" }}>POC:</span> {p?.pocName ?? "—"}
            </div>
            <div>
              <span style={{ color: "#6b7280" }}>Address:</span> {p?.address ?? "—"}
            </div>
            <div>
              <span style={{ color: "#6b7280" }}>Phone:</span>{" "}
              {p?.pocNumber ?? p?.companyNumber ?? "—"}
            </div>
            <div>
              <span style={{ color: "#6b7280" }}>Email:</span>{" "}
              {p?.pocEmail ?? p?.companyEmail ?? "—"}
            </div>
            <div>
              <span style={{ color: "#6b7280" }}>NTN / STN:</span> {p?.ntnNumber ?? "—"} /{" "}
              {p?.salesTaxNumber ?? "—"}
            </div>
          </div>
        </div>

        {/* Line items */}
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: "#2f4a8b", color: "#ffffff" }}>
              {["Client", "Agency", "Duration", "Payable Event", "CAC Rate", "Event Count", "Budget"].map(
                (h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold" style={{ border: "1px solid #2f4a8b" }}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {po.items.map((it) => (
              <tr key={it.id}>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db" }}>{po.clientName}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db" }}>{po.buyingHouseName ?? "—"}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db" }}>{duration}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db" }}>{it.eventName}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db" }}>{it.cacRate}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db" }}>{it.eventCount.toLocaleString()}</td>
                <td className="px-3 py-2" style={{ border: "1px solid #d1d5db" }}>{money(it.lineBudget)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="px-3 py-2 text-right" colSpan={6} style={{ border: "1px solid #d1d5db" }}>
                TOTAL
              </td>
              <td className="px-3 py-2" style={{ border: "1px solid #d1d5db" }}>{money(po.totalBudget)}</td>
            </tr>
          </tbody>
        </table>

        {/* Clause + computer-generated note */}
        <div className="mt-6 space-y-3 text-xs" style={{ color: "#4b5563" }}>
          <p>{CLAUSE}</p>
          <p className="font-medium">
            This is a computer-generated document and does not require a signature or stamp.
          </p>
        </div>

        {/* Footer — Advengers details */}
        <div className="mt-10 pt-4 text-center text-xs" style={{ borderTop: "1px solid #d1d5db", color: "#6b7280" }}>
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
