"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { ParetoPoint } from "@workspace/api-client-react";
import { formatMoney } from "@/lib/analytics/currency";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export function ParetoChart({
  points,
  hhi,
  top5Pct,
  currency,
}: {
  points: ParetoPoint[];
  hhi?: number;
  top5Pct?: number;
  currency?: string;
}) {
  if (!points || points.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No data for selected period</p>;
  }

  return (
    <div>
      {(hhi !== undefined || top5Pct !== undefined) && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {hhi !== undefined && <span>HHI: {hhi.toFixed(0)}</span>}
          {top5Pct !== undefined && <span>Top 5 = {top5Pct.toFixed(0)}%</span>}
        </div>
      )}
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            angle={-25}
            textAnchor="end"
            height={50}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatMoney(v, currency)}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(val: number, name: string) =>
              name === "Cumulative %" ? [`${val.toFixed(1)}%`, name] : [formatMoney(val, currency), name]
            }
          />
          <ReferenceLine yAxisId="right" y={80} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
          <Bar yAxisId="left" dataKey="revenue" fill="hsl(221,83%,53%)" radius={[3, 3, 0, 0]} name="Revenue" />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cumulativePct"
            stroke="hsl(160,84%,39%)"
            strokeWidth={2}
            dot={false}
            name="Cumulative %"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
