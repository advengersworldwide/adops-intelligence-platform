"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useGetProfitOverTime } from "@workspace/api-client-react";
import { formatMoney } from "@/lib/analytics/currency";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useAdjustedSummary } from "@/lib/dashboard/use-adjusted-summary";
import { useDashboardRange } from "@/lib/dashboard/range-context";

export function ProfitTrend() {
  const range = useDashboardRange();
  const { data: profitTimeSeries, isLoading: timeLoading } = useGetProfitOverTime(range as never);
  const { adjustedSummary, baseCurrency, isLoading: summaryLoading } = useAdjustedSummary();

  const isLoading = timeLoading || summaryLoading;
  const isEmpty = !isLoading && (!profitTimeSeries || profitTimeSeries.length === 0);

  return (
    <DashboardWidget title="Profit & Revenue" loading={isLoading} isEmpty={isEmpty} emptyLabel="No profit & revenue data yet">
      <div className="flex h-full flex-col min-h-0">
        {adjustedSummary && (
          <p className="mb-3 shrink-0 text-2xl font-bold tracking-tight text-foreground">{formatMoney(adjustedSummary.totalProfit, baseCurrency)}</p>
        )}
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={profitTimeSeries ?? []} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
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
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                formatter={(val: number, name: string) => [formatMoney(val), name.charAt(0).toUpperCase() + name.slice(1)]}
              />
              <Area type="monotone" dataKey="revenue" stroke="hsl(160,84%,39%)" strokeWidth={1.5} fill="url(#revenueGrad)" />
              <Area type="monotone" dataKey="profit" stroke="hsl(221,83%,53%)" strokeWidth={2} fill="url(#profitGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </DashboardWidget>
  );
}
