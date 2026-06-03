import { useState } from "react";
import { Download } from "lucide-react";
import { useGetProfitOverTime, useGetAnalyticsByClient, useGetAnalyticsByPlatform, useGetDashboardSummary } from "@workspace/api-client-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function fmt(n: number, currency = "USD") {
  const prefix = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : `${currency} `;
  const isNeg = n < 0;
  const absVal = Math.abs(n);
  let valStr = "";
  if (absVal >= 1_000_000) valStr = `${(absVal / 1_000_000).toFixed(1)}M`;
  else if (absVal >= 1_000) valStr = `${(absVal / 1_000).toFixed(1)}K`;
  else valStr = absVal.toFixed(0);
  
  return `${isNeg ? "-" : ""}${prefix}${valStr}`;
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export default function AnalyticsPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const params = {
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };

  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary(params);
  const { data: timeSeries, isLoading: timeLoading } = useGetProfitOverTime(params);
  const { data: byClient, isLoading: clientLoading } = useGetAnalyticsByClient(params);
  const { data: byPlatform, isLoading: platformLoading } = useGetAnalyticsByPlatform(params);

  const baseCurrency = localStorage.getItem("adops-base-currency") || "USD";
  const rawRates = localStorage.getItem("adops-exchange-rates");
  const exchangeRates = rawRates ? JSON.parse(rawRates) : { usd: 1.0, eur: 0.92, gbp: 0.79, inr: 83.0, jpy: 155.0, cad: 1.36, aud: 1.50, pkr: 278.0, sar: 3.75, aed: 3.67 };

  const convert = (amount: number, from: string) => {
    const fromKey = (from || "USD").toLowerCase();
    const rate = exchangeRates[fromKey];
    if (rate && rate > 0) {
      return amount / rate;
    }
    return amount;
  };

  let convertedRevenue = 0;
  let convertedCost = 0;

  if (byPlatform && byPlatform.length > 0) {
    byPlatform.forEach(p => {
      convertedRevenue += convert(p.revenue, "USD");
      convertedCost += convert(p.cost, "USD");
    });
  } else {
    convertedRevenue = summary?.totalRevenue ?? 0;
    convertedCost = summary?.totalCost ?? 0;
  }

  const adjustedProfit = convertedRevenue - convertedCost;
  const adjustedMarginPct = convertedRevenue > 0 ? (adjustedProfit / convertedRevenue) * 100 : 0;

  const adjustedSummary = summary ? {
    ...summary,
    totalRevenue: convertedRevenue,
    totalCost: convertedCost,
    totalProfit: adjustedProfit,
    marginPct: adjustedMarginPct
  } : null;

  const exportCSV = (data: any[] | undefined, name: string) => {
    if (!data || !data.length) return;
    const headers = Object.keys(data[0]);
    const rows = data.map(r => headers.map(h => r[h]).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground">Deep-dive into performance metrics</p>
        </div>
        <div className="flex items-center gap-3">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-32 sm:w-36 text-sm" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-32 sm:w-36 text-sm" />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Revenue", value: adjustedSummary ? fmt(adjustedSummary.totalRevenue, baseCurrency) : "—" },
          { label: "Total Cost", value: adjustedSummary ? fmt(adjustedSummary.totalCost, baseCurrency) : "—" },
          { label: "Total Profit", value: adjustedSummary ? fmt(adjustedSummary.totalProfit, baseCurrency) : "—", profit: true, val: adjustedSummary?.totalProfit },
          { label: "Avg Margin", value: adjustedSummary ? `${adjustedSummary.marginPct.toFixed(1)}%` : "—" },
        ].map(card => (
          <div key={card.label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            {summaryLoading ? <Skeleton className="h-7 w-24 mt-1" /> : (
              <p className={cn("text-xl font-bold mt-1", card.profit ? ((card.val ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400") : "text-foreground")}>
                {card.value}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Profit over time */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Revenue, Cost & Profit Over Time</h2>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => exportCSV(timeSeries, "profit-over-time")} data-testid="export-timeseries-btn">
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </div>
        {timeLoading ? <Skeleton className="h-56 w-full" /> : timeSeries && timeSeries.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={timeSeries} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="anaRevGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(221,83%,53%)" stopOpacity={0.1} />
                  <stop offset="95%" stopColor="hsl(221,83%,53%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="anaProfitGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(160,84%,39%)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="hsl(160,84%,39%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="anaCostGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(0,84%,60%)" stopOpacity={0.08} />
                  <stop offset="95%" stopColor="hsl(0,84%,60%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(val: number, name: string) => [fmt(val), name.charAt(0).toUpperCase() + name.slice(1)]} />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              <Area type="monotone" dataKey="revenue" stroke="hsl(221,83%,53%)" strokeWidth={2} fill="url(#anaRevGrad)" name="revenue" />
              <Area type="monotone" dataKey="cost" stroke="hsl(0,84%,60%)" strokeWidth={1.5} fill="url(#anaCostGrad)" name="cost" />
              <Area type="monotone" dataKey="profit" stroke="hsl(160,84%,39%)" strokeWidth={2} fill="url(#anaProfitGrad)" name="profit" />
            </AreaChart>
          </ResponsiveContainer>
        ) : <p className="py-12 text-center text-sm text-muted-foreground">No data for selected period</p>}
      </div>

      {/* By client and by platform */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">By Client</h2>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => exportCSV(byClient, "analytics-by-client")} data-testid="export-client-btn">
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </div>
          {clientLoading ? <Skeleton className="h-48 w-full" /> : byClient && byClient.length > 0 ? (
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={byClient.slice(0, 8)} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="clientName" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(val: number) => [fmt(val)]} />
                <Bar dataKey="revenue" fill="hsl(221,83%,53%)" radius={[3, 3, 0, 0]} name="Revenue" />
                <Bar dataKey="profit" fill="hsl(160,84%,39%)" radius={[3, 3, 0, 0]} name="Profit" />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="py-10 text-center text-sm text-muted-foreground">No client data</p>}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">By Platform</h2>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => exportCSV(byPlatform, "analytics-by-platform")} data-testid="export-platform-btn">
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </div>
          {platformLoading ? <Skeleton className="h-48 w-full" /> : byPlatform && byPlatform.length > 0 ? (
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={byPlatform.slice(0, 8)} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="platformName" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(val: number) => [fmt(val)]} />
                <Bar dataKey="revenue" fill="hsl(262,80%,60%)" radius={[3, 3, 0, 0]} name="Revenue" />
                <Bar dataKey="profit" fill="hsl(160,84%,39%)" radius={[3, 3, 0, 0]} name="Profit" />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="py-10 text-center text-sm text-muted-foreground">No platform data</p>}
        </div>
      </div>

      {/* Breakdown tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold text-foreground">Client Breakdown</h2>
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Client", "Revenue", "Profit", "Margin"].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>)}
            </tr></thead>
            <tbody>
              {clientLoading ? [...Array(3)].map((_, i) => <tr key={i} className="border-b border-border"><td colSpan={4} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td></tr>)
              : byClient && byClient.length > 0 ? byClient.map(c => (
                <tr key={c.clientId} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5 text-xs font-medium text-foreground">{c.clientName}</td>
                  <td className="px-4 py-2.5 text-xs">{fmt(c.revenue)}</td>
                  <td className={cn("px-4 py-2.5 text-xs font-semibold", c.profit < 0 ? "text-red-600" : "text-emerald-600")}>{fmt(c.profit)}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.marginPct.toFixed(1)}%</td>
                </tr>
              )) : <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-muted-foreground">No data</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold text-foreground">Platform Breakdown</h2>
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-border bg-muted/30">
              {["Platform", "Revenue", "Profit", "Margin"].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>)}
            </tr></thead>
            <tbody>
              {platformLoading ? [...Array(3)].map((_, i) => <tr key={i} className="border-b border-border"><td colSpan={4} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td></tr>)
              : byPlatform && byPlatform.length > 0 ? byPlatform.map(p => (
                <tr key={p.platformId} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5 text-xs font-medium text-foreground">{p.platformName}</td>
                  <td className="px-4 py-2.5 text-xs">{fmt(p.revenue)}</td>
                  <td className={cn("px-4 py-2.5 text-xs font-semibold", p.profit < 0 ? "text-red-600" : "text-emerald-600")}>{fmt(p.profit)}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.marginPct.toFixed(1)}%</td>
                </tr>
              )) : <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-muted-foreground">No data</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
