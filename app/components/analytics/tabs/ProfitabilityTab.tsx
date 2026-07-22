"use client";

import {
  useGetDashboardSummary,
  useGetProfitOverTime,
  useGetAnalyticsByClient,
  useGetProfitWaterfall,
  useGetMarginDistribution,
} from "@workspace/api-client-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveChart } from "@/components/analytics/ResponsiveChart";
import { useAnalyticsFilters } from "@/hooks/use-analytics-filters";
import { buildAnalyticsParams } from "@/lib/analytics/filters";
import { formatMoney } from "@/lib/analytics/currency";
import { WidgetErrorBoundary } from "@/components/analytics/WidgetErrorBoundary";
import { KpiCard } from "@/components/analytics/KpiCard";
import { WaterfallChart } from "@/components/analytics/charts/WaterfallChart";
import { MarginQuadrant } from "@/components/analytics/charts/MarginQuadrant";
import { MarginHistogram } from "@/components/analytics/charts/MarginHistogram";
import { Skeleton } from "@/components/ui/skeleton";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export function ProfitabilityTab() {
  const { filters } = useAnalyticsFilters();
  const params = buildAnalyticsParams(filters);

  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary(params as never);
  const { data: profitSeries, isLoading: profitSeriesLoading } = useGetProfitOverTime(params as never);
  const { data: byClient, isLoading: byClientLoading } = useGetAnalyticsByClient(params as never);
  const { data: waterfallData, isLoading: waterfallLoading } = useGetProfitWaterfall(params as never);
  const { data: marginDist, isLoading: marginDistLoading } = useGetMarginDistribution(params as never);

  const profitSparkline = profitSeries?.map((p) => p.profit) ?? [];

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <WidgetErrorBoundary title="Key Metrics">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total Revenue"
            value={summary ? formatMoney(summary.totalRevenue) : "—"}
            delta={summary?.revenueChange}
            positive={(summary?.revenueChange ?? 0) >= 0}
            loading={summaryLoading}
          />
          <KpiCard
            title="Total Partner Payout"
            value={summary ? formatMoney(summary.totalCost) : "—"}
            delta={summary?.costChange}
            positive={(summary?.costChange ?? 0) <= 0}
            loading={summaryLoading}
          />
          <KpiCard
            title="Total Profit"
            value={summary ? formatMoney(summary.totalProfit) : "—"}
            delta={summary?.profitChange}
            positive={(summary?.profitChange ?? 0) >= 0}
            sparkline={profitSparkline}
            loading={summaryLoading}
          />
          <KpiCard
            title="Margin %"
            value={summary ? `${summary.marginPct.toFixed(1)}%` : "—"}
            loading={summaryLoading}
          />
        </div>
      </WidgetErrorBoundary>

      {/* Profit trend */}
      <WidgetErrorBoundary title="Revenue, Cost & Profit Over Time">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Revenue, Cost &amp; Profit Over Time</h2>
          {profitSeriesLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : profitSeries && profitSeries.length > 0 ? (
            <ResponsiveChart width="100%" height={220}>
              <AreaChart data={profitSeries} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="profitTabRevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(221,83%,53%)" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="hsl(221,83%,53%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="profitTabProfitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(160,84%,39%)" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="hsl(160,84%,39%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="profitTabCostGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(0,84%,60%)" stopOpacity={0.08} />
                    <stop offset="95%" stopColor="hsl(0,84%,60%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(val: number, name: string) => [formatMoney(val), name.charAt(0).toUpperCase() + name.slice(1)]}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(221,83%,53%)" strokeWidth={2} fill="url(#profitTabRevGrad)" name="revenue" />
                <Area type="monotone" dataKey="cost" stroke="hsl(0,84%,60%)" strokeWidth={1.5} fill="url(#profitTabCostGrad)" name="cost" />
                <Area type="monotone" dataKey="profit" stroke="hsl(160,84%,39%)" strokeWidth={2} fill="url(#profitTabProfitGrad)" name="profit" />
              </AreaChart>
            </ResponsiveChart>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No data for selected period</p>
          )}
        </div>
      </WidgetErrorBoundary>

      {/* Profit-leakage waterfall */}
      <WidgetErrorBoundary title="Profit Leakage">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Profit Leakage Waterfall</h2>
          {waterfallLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <WaterfallChart stages={(waterfallData ?? []) as never} />
          )}
        </div>
      </WidgetErrorBoundary>

      {/* Revenue x Margin quadrant + Margin distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WidgetErrorBoundary title="Revenue × Margin">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Revenue × Margin Quadrant</h2>
            {byClientLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <MarginQuadrant
                points={(byClient ?? []).map((c) => ({ clientName: c.clientName, revenue: c.revenue, marginPct: c.marginPct }))}
              />
            )}
          </div>
        </WidgetErrorBoundary>

        <WidgetErrorBoundary title="Margin Distribution">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Margin Distribution</h2>
            {marginDistLoading ? <Skeleton className="h-52 w-full" /> : <MarginHistogram buckets={marginDist ?? []} />}
          </div>
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}
