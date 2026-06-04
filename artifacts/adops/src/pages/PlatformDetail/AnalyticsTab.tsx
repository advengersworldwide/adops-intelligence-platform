import { useState } from "react";
import { useListBillingRecords } from "@workspace/api-client-react";
import type { Platform } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

function computeNetMargin(
  appsflyerPins: number, fraudPins: number, payoutRate: number,
  marginPct: number, salesTaxPct: number, remittanceTaxPct: number, forexRate: number,
  withholdingTaxPct: number
) {
  const actualPins = appsflyerPins - fraudPins;
  const netAmtUsd = actualPins * payoutRate;
  const netAmtPkr = netAmtUsd * forexRate;
  const grossAmtPkr = marginPct > 0 ? netAmtPkr / (1 - marginPct / 100) : netAmtPkr;
  const salesTax = grossAmtPkr * (salesTaxPct / 100);
  const totalAmtPkr = grossAmtPkr + salesTax;
  const receivablePkr = totalAmtPkr - (totalAmtPkr * withholdingTaxPct / 100) - salesTax;
  const netPayableUsd = netAmtUsd * (1 - marginPct / 100);
  const remittanceTax = netPayableUsd * (remittanceTaxPct / 100);
  const totalPayableUsd = netPayableUsd + remittanceTax;
  const totalPayablePkr = totalPayableUsd * forexRate;
  return {
    receivablePkr,
    totalPayablePkr,
    netMarginPkr: receivablePkr - totalPayablePkr,
  };
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export default function PlatformAnalyticsTab({ platformId, platform }: { platformId: number; platform: Platform }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: records, isLoading } = useListBillingRecords(platformId, {});

  const allComputed = (records ?? []).map(r => ({
    ...r,
    ...computeNetMargin(
      r.appsflyerPins, r.fraudPins, r.payoutRate ?? 0, r.marginPct ?? 0,
      r.salesTaxPct ?? 0, r.remittanceTaxPct ?? 0, r.forexRate ?? 278, r.withholdingTaxPct ?? 0
    ),
  }));

  const filtered = allComputed.filter(r => {
    if (dateFrom && r.period < dateFrom.slice(0, 7)) return false;
    if (dateTo && r.period > dateTo.slice(0, 7)) return false;
    return true;
  });

  const totalReceivable = filtered.reduce((s, r) => s + r.receivablePkr, 0);
  const totalPayable = filtered.reduce((s, r) => s + r.totalPayablePkr, 0);
  const totalMargin = totalReceivable - totalPayable;
  const overallMarginPct = totalReceivable > 0 ? (totalMargin / totalReceivable) * 100 : 0;

  const byPeriod = new Map<string, { receivable: number; payable: number; margin: number }>();
  for (const r of filtered) {
    const e = byPeriod.get(r.period) ?? { receivable: 0, payable: 0, margin: 0 };
    byPeriod.set(r.period, { receivable: e.receivable + r.receivablePkr, payable: e.payable + r.totalPayablePkr, margin: e.margin + r.netMarginPkr });
  }
  const trendData = Array.from(byPeriod.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([period, v]) => ({ period, ...v }));

  const byClient = new Map<string, number>();
  for (const r of filtered) {
    const n = r.clientName ?? "Unknown";
    byClient.set(n, (byClient.get(n) ?? 0) + r.netMarginPkr);
  }
  const clientData = Array.from(byClient.entries()).map(([name, margin]) => ({ name, margin }));

  const fmt = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toFixed(0);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Input type="month" className="w-36 text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="month" className="w-36 text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPI label="Total Receivable (PKR)" value={`₨ ${fmt(totalReceivable)}`} />
          <KPI label="Total Payable (PKR)" value={`₨ ${fmt(totalPayable)}`} />
          <KPI label="Net Margin (PKR)" value={`₨ ${fmt(totalMargin)}`} />
          <KPI label="Margin %" value={`${overallMarginPct.toFixed(1)}%`} />
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Monthly Net Margin (PKR)</h3>
        {isLoading ? <Skeleton className="h-48 w-full" /> : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`₨ ${fmt(v)}`, ""]} />
              <Area type="monotone" dataKey="margin" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} name="Net Margin" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Net Margin by Billing Entity (PKR)</h3>
        {isLoading ? <Skeleton className="h-48 w-full" /> : (
          <ResponsiveContainer width="100%" height={Math.max(180, clientData.length * 44)}>
            <BarChart data={clientData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" tickFormatter={v => fmt(v as number)} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={100} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`₨ ${fmt(v)}`, "Net Margin"]} />
              <Bar dataKey="margin" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
