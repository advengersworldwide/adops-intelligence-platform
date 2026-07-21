"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useGetProfitOverTime } from "@workspace/api-client-react";
import { formatMoney } from "@/lib/analytics/currency";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function ProfitTrend() {
  const { data: profitTimeSeries, isLoading: timeLoading } = useGetProfitOverTime();

  return (
    <DashboardWidget
      title="Profit & Revenue"
      loading={timeLoading}
      isEmpty={!profitTimeSeries || profitTimeSeries.length === 0}
      emptyLabel="No data yet."
    >
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
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
            formatter={(val: number, name: string) => [formatMoney(val), name.charAt(0).toUpperCase() + name.slice(1)]}
          />
          <Area type="monotone" dataKey="revenue" stroke="hsl(160,84%,39%)" strokeWidth={1.5} fill="url(#revenueGrad)" />
          <Area type="monotone" dataKey="profit" stroke="hsl(221,83%,53%)" strokeWidth={2} fill="url(#profitGrad)" />
        </AreaChart>
      </ResponsiveContainer>
    </DashboardWidget>
  );
}
