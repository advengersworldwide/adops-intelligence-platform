"use client";

import { forwardRef } from "react";
import type { PartnerPurchaseOrder } from "@workspace/api-client-react";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const CLAUSE = "[Clause text to be provided by Advengers.]";

export const PartnerInvoice = forwardRef<HTMLDivElement, { po: PartnerPurchaseOrder }>(
  function PartnerInvoice({ po }, ref) {
    const p = po.partner;
    const duration = `${fmt(po.startDate)} – ${fmt(po.endDate)}`;
    return (
      <div ref={ref} className="mx-auto w-[800px] bg-white p-12 text-[#1f2937]" data-testid="invoice-doc">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-[#2f4a8b] pb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/advengers-logo.png" alt="Advengers" className="h-12 object-contain" />
          <div className="text-right">
            <h2 className="text-2xl font-bold tracking-wide text-[#2f4a8b]">PURCHASE ORDER</h2>
            <p className="mt-1 text-sm">
              Invoice No: <span className="font-semibold">{po.code}</span>
            </p>
            <p className="text-sm">Date: {fmt(po.createdAt)}</p>
          </div>
        </div>

        {/* Vendor (partner KYC) */}
        <div className="mt-6">
          <div className="bg-[#2f4a8b] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white">
            Vendor
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <div>
              <span className="text-gray-500">Name:</span> {p?.name ?? "—"}
            </div>
            <div>
              <span className="text-gray-500">POC:</span> {p?.pocName ?? "—"}
            </div>
            <div>
              <span className="text-gray-500">Address:</span> {p?.address ?? "—"}
            </div>
            <div>
              <span className="text-gray-500">Phone:</span>{" "}
              {p?.pocNumber ?? p?.companyNumber ?? "—"}
            </div>
            <div>
              <span className="text-gray-500">Email:</span>{" "}
              {p?.pocEmail ?? p?.companyEmail ?? "—"}
            </div>
            <div>
              <span className="text-gray-500">NTN / STN:</span> {p?.ntnNumber ?? "—"} /{" "}
              {p?.salesTaxNumber ?? "—"}
            </div>
          </div>
        </div>

        {/* Line items */}
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#2f4a8b] text-white">
              {["Client", "Agency", "Duration", "Payable Event", "CAC Rate", "Event Count", "Budget"].map(
                (h) => (
                  <th key={h} className="border border-[#2f4a8b] px-3 py-2 text-left font-semibold">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {po.items.map((it) => (
              <tr key={it.id}>
                <td className="border border-gray-300 px-3 py-2">{po.clientName}</td>
                <td className="border border-gray-300 px-3 py-2">{po.buyingHouseName ?? "—"}</td>
                <td className="border border-gray-300 px-3 py-2">{duration}</td>
                <td className="border border-gray-300 px-3 py-2">{it.eventName}</td>
                <td className="border border-gray-300 px-3 py-2">{it.cacRate}</td>
                <td className="border border-gray-300 px-3 py-2">{it.eventCount.toLocaleString()}</td>
                <td className="border border-gray-300 px-3 py-2">{money(it.lineBudget)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="border border-gray-300 px-3 py-2 text-right" colSpan={6}>
                TOTAL
              </td>
              <td className="border border-gray-300 px-3 py-2">{money(po.totalBudget)}</td>
            </tr>
          </tbody>
        </table>

        {/* Clause + computer-generated note */}
        <div className="mt-6 space-y-3 text-xs text-gray-600">
          <p>{CLAUSE}</p>
          <p className="font-medium">
            This is a computer-generated document and does not require a signature or stamp.
          </p>
        </div>

        {/* Footer — Advengers details */}
        <div className="mt-10 border-t border-gray-300 pt-4 text-center text-xs text-gray-500">
          <p className="font-semibold text-[#2f4a8b]">Advengers</p>
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
