import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, DollarSign, Target, Users, Monitor, Megaphone, AlertTriangle, Plus, X, BarChart2, GripHorizontal } from "lucide-react";
import { useGetDashboardSummary, useGetProfitOverTime, useGetAnalyticsByClient, useGetAlerts, useListTransactions, getGetDashboardSummaryQueryKey, getGetProfitOverTimeQueryKey, useGetAnalyticsByPartner } from "@workspace/api-client-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveGridLayout, useContainerWidth, type ResponsiveGridLayoutProps } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const RGL = ResponsiveGridLayout as React.ComponentType<ResponsiveGridLayoutProps & { draggableHandle?: string }>;

const widgetOptions = [
  { id: "revenue", label: "Revenue", description: "Total client spend over time" },
  { id: "cost", label: "Cost", description: "Platform costs incurred" },
  { id: "profit", label: "Profit", description: "Net profit (revenue − cost)" },
  { id: "client-performance", label: "Client Performance", description: "Breakdown by client" },
  { id: "platform-performance", label: "Platform Performance", description: "Breakdown by platform" },
];

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

function fmtPct(n: number | null | undefined) {
  if (n == null) return null;
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

interface KpiCardProps {
  title: string;
  value: string;
  change?: string | null;
  positive?: boolean;
  icon: React.ReactNode;
  loading?: boolean;
}
function KpiCard({ title, value, change, positive, icon, loading }: KpiCardProps) {
  return (
    <div className="flex flex-col h-full rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex justify-center p-1 cursor-grab active:cursor-grabbing bg-muted/10 border-b border-border widget-drag-handle">
        <GripHorizontal className="h-3 w-3 text-muted-foreground/50" />
      </div>
      <div className="flex-1 p-5 flex flex-col justify-center">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="mt-2 h-8 w-28" />
            ) : (
              <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{value}</p>
            )}
            {change && !loading && (
              <div className={cn(
                "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                positive ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                  : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
              )}>
                {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {change}
              </div>
            )}
          </div>
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">{icon}</div>
        </div>
      </div>
    </div>
  );
}

const defaultLayout: any[] = [
  { i: "revenue-kpi", x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "cost-kpi", x: 3, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "profit-kpi", x: 6, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "margin-kpi", x: 9, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "counts-row", x: 0, y: 3, w: 12, h: 3, minW: 6, minH: 2 },
  { i: "profit-chart", x: 0, y: 6, w: 8, h: 9, minW: 4, minH: 6 },
  { i: "alerts-panel", x: 8, y: 6, w: 4, h: 9, minW: 3, minH: 4 },
  { i: "client-performance-chart", x: 0, y: 15, w: 6, h: 8, minW: 4, minH: 5 },
  { i: "platform-performance-chart", x: 6, y: 15, w: 6, h: 8, minW: 4, minH: 5 },
  { i: "transactions-table", x: 0, y: 23, w: 12, h: 8, minW: 6, minH: 5 },
];

export default function DashboardPage() {
  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [activeWidgets, setActiveWidgets] = useState<string[]>(() => {
    const saved = localStorage.getItem("adops-dashboard-active-widgets");
    return saved ? JSON.parse(saved) : ["revenue", "profit", "client-performance"];
  });
  const [layout, setLayout] = useState<any[]>(() => {
    const saved = localStorage.getItem("adops-dashboard-layout");
    return saved ? JSON.parse(saved) : defaultLayout;
  });
  const { width, containerRef } = useContainerWidth();

  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: profitTimeSeries, isLoading: timeLoading } = useGetProfitOverTime();
  const { data: byClient, isLoading: clientLoading } = useGetAnalyticsByClient();
  const { data: byPlatform } = useGetAnalyticsByPartner();
  const { data: alerts } = useGetAlerts();
  const { data: transactions, isLoading: txLoading } = useListTransactions({ limit: 10 } as never);

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

  const topCampaigns = transactions?.slice(0, 8) ?? [];

  const toggleWidget = (id: string) => {
    setActiveWidgets(prev => {
      const next = prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id];
      localStorage.setItem("adops-dashboard-active-widgets", JSON.stringify(next));
      return next;
    });
  };

  const onLayoutChange = (newLayout: any[]) => {
    setLayout(newLayout);
    localStorage.setItem("adops-dashboard-layout", JSON.stringify(newLayout));
  };

  return (
    <div className="space-y-6 pb-12" ref={containerRef}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">AdOps Intelligence Overview</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setWidgetModalOpen(true)} className="gap-1.5 text-xs" data-testid="add-widget-btn">
            <Plus className="h-3.5 w-3.5" /> Add Widget
          </Button>
        </div>
      </div>

      <RGL
        className="layout"
        width={width}
        layouts={{ lg: layout }}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={30}
        onLayoutChange={onLayoutChange}
        draggableHandle=".widget-drag-handle"
        margin={[16, 16]}
      >
        {activeWidgets.includes("revenue") && (
          <div key="revenue-kpi">
            <KpiCard
              title="Total Revenue"
              value={adjustedSummary ? fmt(adjustedSummary.totalRevenue, baseCurrency) : "$0"}
              change={fmtPct(adjustedSummary?.revenueChange)}
              positive={(adjustedSummary?.revenueChange ?? 0) >= 0}
              icon={<DollarSign className="h-4 w-4" />}
              loading={summaryLoading}
            />
          </div>
        )}

        {activeWidgets.includes("cost") && (
          <div key="cost-kpi">
            <KpiCard
              title="Total Cost"
              value={adjustedSummary ? fmt(adjustedSummary.totalCost, baseCurrency) : "$0"}
              change={fmtPct(adjustedSummary?.costChange)}
              positive={(adjustedSummary?.costChange ?? 0) <= 0}
              icon={<Target className="h-4 w-4" />}
              loading={summaryLoading}
            />
          </div>
        )}

        {activeWidgets.includes("profit") && (
          <div key="profit-kpi">
            <KpiCard
              title="Total Profit"
              value={adjustedSummary ? fmt(adjustedSummary.totalProfit, baseCurrency) : "$0"}
              change={fmtPct(adjustedSummary?.profitChange)}
              positive={(adjustedSummary?.profitChange ?? 0) >= 0}
              icon={<TrendingUp className="h-4 w-4" />}
              loading={summaryLoading}
            />
          </div>
        )}
        
        {activeWidgets.includes("profit") && (
          <div key="margin-kpi">
            <KpiCard
              title="Margin %"
              value={adjustedSummary ? `${adjustedSummary.marginPct.toFixed(1)}%` : "0%"}
              icon={<BarChart2 className="h-4 w-4" />}
              loading={summaryLoading}
            />
          </div>
        )}

        <div key="counts-row" className="flex flex-col h-full rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex justify-center p-1 cursor-grab active:cursor-grabbing bg-muted/10 border-b border-border widget-drag-handle shrink-0">
            <GripHorizontal className="h-3 w-3 text-muted-foreground/50" />
          </div>
          <div className="flex-1 p-4 grid grid-cols-3 gap-4 items-center">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-50 dark:bg-blue-950 p-2.5 text-blue-600"><Users className="h-4 w-4" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Clients</p>
                {summaryLoading ? <Skeleton className="h-5 w-8 mt-1" /> : <p className="font-bold text-lg text-foreground">{adjustedSummary?.clientCount ?? 0}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-purple-50 dark:bg-purple-950 p-2.5 text-purple-600"><Monitor className="h-4 w-4" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Platforms</p>
                {summaryLoading ? <Skeleton className="h-5 w-8 mt-1" /> : <p className="font-bold text-lg text-foreground">{adjustedSummary?.platformCount ?? 0}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-orange-50 dark:bg-orange-950 p-2.5 text-orange-600"><Megaphone className="h-4 w-4" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Campaigns</p>
                {summaryLoading ? <Skeleton className="h-5 w-8 mt-1" /> : <p className="font-bold text-lg text-foreground">{adjustedSummary?.campaignCount ?? 0}</p>}
              </div>
            </div>
          </div>
        </div>

        {activeWidgets.includes("profit") && (
          <div key="profit-chart" className="flex flex-col h-full rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="flex justify-center p-1 cursor-grab active:cursor-grabbing bg-muted/10 border-b border-border widget-drag-handle shrink-0">
              <GripHorizontal className="h-3 w-3 text-muted-foreground/50" />
            </div>
            <div className="flex-1 p-5 flex flex-col min-h-0">
              <div className="mb-4 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Total Profit</h2>
                  {adjustedSummary && (
                    <p className="text-2xl font-bold text-foreground mt-0.5">{fmt(adjustedSummary.totalProfit, baseCurrency)}</p>
                  )}
                </div>
              </div>
              <div className="flex-1 min-h-0">
                {timeLoading ? (
                  <Skeleton className="h-full w-full" />
                ) : profitTimeSeries && profitTimeSeries.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={profitTimeSeries} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(221,83%,53%)" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="hsl(221,83%,53%)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(160,84%,39%)" stopOpacity={0.1} />
                          <stop offset="95%" stopColor="hsl(160,84%,39%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                        formatter={(val: number, name: string) => [fmt(val), name.charAt(0).toUpperCase() + name.slice(1)]}
                      />
                      <Area type="monotone" dataKey="revenue" stroke="hsl(160,84%,39%)" strokeWidth={1.5} fill="url(#revenueGrad)" />
                      <Area type="monotone" dataKey="profit" stroke="hsl(221,83%,53%)" strokeWidth={2} fill="url(#profitGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data yet.</div>
                )}
              </div>
            </div>
          </div>
        )}

        <div key="alerts-panel" className="flex flex-col h-full rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex justify-center p-1 cursor-grab active:cursor-grabbing bg-muted/10 border-b border-border widget-drag-handle shrink-0">
            <GripHorizontal className="h-3 w-3 text-muted-foreground/50" />
          </div>
          <div className="flex-1 p-4 overflow-y-auto">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-foreground">Alerts</h3>
              {alerts && alerts.length > 0 && (
                <Badge variant="destructive" className="ml-auto text-xs">{alerts.length}</Badge>
              )}
            </div>
            {alerts && alerts.length > 0 ? (
              <div className="space-y-2">
                {alerts.map(a => (
                  <div key={a.id} className={cn(
                    "rounded-lg p-2.5 text-xs",
                    a.severity === "critical" ? "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400" : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400"
                  )}>
                    <p className="font-medium">{a.campaignName}</p>
                    <p className="text-[10px] opacity-80 mt-0.5">{a.message}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No active alerts</p>
            )}
          </div>
        </div>

        {activeWidgets.includes("client-performance") && (
          <div key="client-performance-chart" className="flex flex-col h-full rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="flex justify-center p-1 cursor-grab active:cursor-grabbing bg-muted/10 border-b border-border widget-drag-handle shrink-0">
              <GripHorizontal className="h-3 w-3 text-muted-foreground/50" />
            </div>
            <div className="flex-1 p-5 flex flex-col min-h-0">
              <h2 className="mb-4 text-sm font-semibold text-foreground shrink-0">Client Performance</h2>
              <div className="flex-1 min-h-0">
                {clientLoading ? (
                  <Skeleton className="h-full w-full" />
                ) : byClient && byClient.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byClient.slice(0, 8)} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="clientName" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                        formatter={(val: number) => [fmt(val)]}
                      />
                      <Bar dataKey="revenue" fill="hsl(221,83%,53%)" radius={[4, 4, 0, 0]} name="Revenue" />
                      <Bar dataKey="profit" fill="hsl(160,84%,39%)" radius={[4, 4, 0, 0]} name="Profit" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No client data yet</div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeWidgets.includes("platform-performance") && (
          <div key="platform-performance-chart" className="flex flex-col h-full rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="flex justify-center p-1 cursor-grab active:cursor-grabbing bg-muted/10 border-b border-border widget-drag-handle shrink-0">
              <GripHorizontal className="h-3 w-3 text-muted-foreground/50" />
            </div>
            <div className="flex-1 p-5 flex flex-col min-h-0">
              <h2 className="mb-4 text-sm font-semibold text-foreground shrink-0">Platform Performance</h2>
              <div className="flex-1 min-h-0">
                {!byPlatform ? (
                  <Skeleton className="h-full w-full" />
                ) : byPlatform.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byPlatform.slice(0, 8)} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="platformName" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                        formatter={(val: number) => [fmt(val)]}
                      />
                      <Bar dataKey="revenue" fill="hsl(221,83%,53%)" radius={[4, 4, 0, 0]} name="Revenue" />
                      <Bar dataKey="profit" fill="hsl(160,84%,39%)" radius={[4, 4, 0, 0]} name="Profit" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No platform data yet</div>
                )}
              </div>
            </div>
          </div>
        )}

        <div key="transactions-table" className="flex flex-col h-full rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex justify-center p-1 cursor-grab active:cursor-grabbing bg-muted/10 border-b border-border widget-drag-handle shrink-0">
            <GripHorizontal className="h-3 w-3 text-muted-foreground/50" />
          </div>
          <div className="border-b border-border px-5 py-4 shrink-0">
            <h2 className="text-sm font-semibold text-foreground">Recent Transactions</h2>
          </div>
          <div className="flex-1 overflow-x-auto min-h-0">
            <table className="w-full">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  {["Campaign", "Client", "Platform", "Spend", "Cost", "Profit", "Margin"].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txLoading ? (
                  [...Array(4)].map((_, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      {[...Array(7)].map((_, j) => (
                        <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>
                      ))}
                    </tr>
                  ))
                ) : topCampaigns.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-muted-foreground">No transactions yet. Upload data to get started.</td></tr>
                ) : (
                  topCampaigns.map(tx => {
                    const isNeg = tx.profit < 0;
                    const isLow = !isNeg && (tx.marginPct ?? 100) < 10;
                    return (
                      <tr key={tx.id} className={cn(
                        "border-b border-border last:border-0 transition-colors hover:bg-muted/30",
                        isNeg && "bg-red-50/50 dark:bg-red-950/20",
                        isLow && "bg-amber-50/50 dark:bg-amber-950/20"
                      )}>
                        <td className="px-5 py-3 text-xs font-medium text-foreground">{tx.campaignName ?? "—"}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">{tx.clientName ?? "—"}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">{tx.platformName ?? "—"}</td>
                        <td className="px-5 py-3 text-xs font-medium">{fmt(tx.spend)}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">{fmt(tx.cost)}</td>
                        <td className={cn("px-5 py-3 text-xs font-semibold", isNeg ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                          {fmt(tx.profit)}
                        </td>
                        <td className="px-5 py-3 text-xs">
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            isNeg ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                            isLow ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
                            "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                          )}>
                            {tx.marginPct != null ? `${tx.marginPct.toFixed(1)}%` : "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </RGL>

      {/* Add Widget Modal */}
      <Dialog open={widgetModalOpen} onOpenChange={setWidgetModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Widget</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {widgetOptions.map(w => (
              <div
                key={w.id}
                onClick={() => toggleWidget(w.id)}
                data-testid={`widget-option-${w.id}`}
                className={cn(
                  "flex cursor-pointer items-center justify-between rounded-xl border p-3.5 transition-all",
                  activeWidgets.includes(w.id)
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:bg-muted/50"
                )}
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{w.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{w.description}</p>
                </div>
                {activeWidgets.includes(w.id) && (
                  <div className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">Active</div>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setWidgetModalOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
