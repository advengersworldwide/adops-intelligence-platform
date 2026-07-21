"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useGetAnalyticsByClient } from "@workspace/api-client-react";
import { formatMoney } from "@/lib/analytics/currency";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function ClientPerformance() {
  const { data: byClient, isLoading: clientLoading } = useGetAnalyticsByClient();

  return (
    <DashboardWidget
      title="Client Performance"
      loading={clientLoading}
      isEmpty={!byClient || byClient.length === 0}
      emptyLabel="No client data yet"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={byClient?.slice(0, 8)} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="clientName" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
            formatter={(val: number) => [formatMoney(val)]}
          />
          <Bar dataKey="revenue" fill="hsl(221,83%,53%)" radius={[4, 4, 0, 0]} name="Revenue" />
          <Bar dataKey="profit" fill="hsl(160,84%,39%)" radius={[4, 4, 0, 0]} name="Profit" />
        </BarChart>
      </ResponsiveContainer>
    </DashboardWidget>
  );
}
