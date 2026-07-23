"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { useListBillingRecords, useListBuyingHouses, useListClients } from "@workspace/api-client-react";
import type { Partner } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { computeRow } from "@/lib/compute-row";
import { cn } from "@/lib/utils";

function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
type TH = { children?: React.ReactNode };
const TH = ({ children }: TH) => <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{children}</th>;
type TD = { children?: React.ReactNode; bold?: boolean; className?: string };
const TD = ({ children, bold, className }: TD) => <td className={cn("px-3 py-2 text-xs whitespace-nowrap", bold && "font-semibold", className)}>{children}</td>;

export default function PlatformDataTab({ platformId, platform }: { platformId: number; platform: Partner }) {
  const [periodFilter, setPeriodFilter] = useState("");
  const [bhFilter, setBhFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");

  const params = {
    ...(periodFilter ? { period: periodFilter } : {}),
    ...(bhFilter !== "all" ? { buyingHouseId: parseInt(bhFilter) } : {}),
    ...(clientFilter !== "all" ? { clientId: parseInt(clientFilter) } : {}),
  };
  const { data: records, isLoading } = useListBillingRecords(platformId, params);
  const { data: buyingHouses } = useListBuyingHouses();
  const { data: clients } = useListClients();

  const computed = (records ?? []).map(r => ({
    ...r,
    ...computeRow({
      pins: r.pins,
      fraudPins: r.fraudPins,
      payoutRate: String(r.payoutRate ?? 0),
      marginPct: String(r.marginPct ?? 0),
      forexSellingRate: String(r.forexSellingRate ?? 0),
      forexBuyingRate: String(r.forexBuyingRate ?? 0),
      salesTaxPct: String(r.salesTaxPct ?? 0),
      remittanceTaxPct: String(r.remittanceTaxPct ?? 0),
      withholdingTaxPct: String(r.withholdingTaxPct ?? 0),
      bulkDiscountPct: String(r.bulkDiscountPct ?? 0),
      platformBulkDiscountPct: String(r.platformBulkDiscountPct ?? 0),
    }),
  }));

  const totals = computed.reduce((acc, r) => ({
    pins: acc.pins + r.pins,
    fraudPins: acc.fraudPins + r.fraudPins,
    actualPins: acc.actualPins + r.actualPins,
    netPayableUsd: acc.netPayableUsd + r.netPayableUsd,
    remittanceTax: acc.remittanceTax + r.remittanceTax,
    totalPayableUsd: acc.totalPayableUsd + r.totalPayableUsd,
    platformDiscountAmt: acc.platformDiscountAmt + r.platformDiscountAmt,
    totalPayablePkr: acc.totalPayablePkr + r.totalPayablePkr,
  }), { pins: 0, fraudPins: 0, actualPins: 0, netPayableUsd: 0, remittanceTax: 0, totalPayableUsd: 0, platformDiscountAmt: 0, totalPayablePkr: 0 });

  const exportCSV = () => {
    if (!computed.length) return;
    const headers = ["S#","Client","Via (BH)","Period","MMP Pins","Fraud Pins","Actual Pins","Payout Rate","Net Payable (USD)","Remittance Tax","Total Payable (USD)","Forex Buying Rate","Platform Discount","Total Payable (PKR)"];
    const rows = computed.map((r,i) => [i+1,r.clientName??"",r.buyingHouseName??"",r.period,r.pins,r.fraudPins,r.actualPins,(r.payoutRate ?? 0).toFixed(4),r.netPayableUsd.toFixed(2),r.remittanceTax.toFixed(2),r.totalPayableUsd.toFixed(2),r.forexBuyingRate,r.platformDiscountAmt.toFixed(2),r.totalPayablePkr.toFixed(2)]);
    const csv = [headers,...rows].map(r=>r.join(",")).join("\n");
    const blob = new Blob([csv],{type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`data-${platform.name}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="month" className="w-40 text-sm" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} />
        <Select value={bhFilter} onValueChange={setBhFilter}>
          <SelectTrigger className="w-44 text-sm"><SelectValue placeholder="All buying houses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All buying houses</SelectItem>
            {buyingHouses?.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-40 text-sm"><SelectValue placeholder="All clients" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={exportCSV}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <TH>S#</TH><TH>Client</TH><TH>Via (BH)</TH><TH>Period</TH>
              <TH>MMP Pins</TH><TH>Fraud Pins</TH><TH>Actual Pins</TH><TH>Payout Rate</TH>
              <TH>Net Payable (USD)</TH><TH>Remittance Tax</TH><TH>Total Payable (USD)</TH>
              <TH>Forex Buying Rate</TH><TH>Platform Discount</TH><TH>Total Payable (PKR)</TH>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_,i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(14)].map((_,j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                </tr>
              ))
            ) : computed.length === 0 ? (
              <tr><td colSpan={14} className="px-5 py-10 text-center text-sm text-muted-foreground">No data records</td></tr>
            ) : (
              <>
                {computed.map((r, i) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <TD>{i+1}</TD><TD bold>{r.clientName??"—"}</TD><TD>{r.buyingHouseName??"—"}</TD>
                    <TD bold>{r.period}</TD>
                    <TD>{r.pins.toLocaleString()}</TD><TD>{r.fraudPins.toLocaleString()}</TD>
                    <TD bold>{r.actualPins.toLocaleString()}</TD>
                    <TD>{fmtNum(r.payoutRate,4)}</TD>
                    <TD>{fmtNum(r.netPayableUsd)}</TD><TD>{fmtNum(r.remittanceTax)}</TD>
                    <TD>{fmtNum(r.totalPayableUsd)}</TD>
                    <TD>{fmtNum(r.forexBuyingRate,4)}</TD>
                    <TD>{fmtNum(r.platformDiscountAmt)}</TD>
                    <TD bold>{fmtNum(r.totalPayablePkr)}</TD>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-muted/30">
                  <TD bold></TD><TD bold>Total</TD><TD></TD><TD></TD>
                  <TD bold>{totals.pins.toLocaleString()}</TD>
                  <TD bold>{totals.fraudPins.toLocaleString()}</TD>
                  <TD bold>{totals.actualPins.toLocaleString()}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.netPayableUsd)}</TD>
                  <TD bold>{fmtNum(totals.remittanceTax)}</TD>
                  <TD bold>{fmtNum(totals.totalPayableUsd)}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.platformDiscountAmt)}</TD>
                  <TD bold>{fmtNum(totals.totalPayablePkr)}</TD>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
