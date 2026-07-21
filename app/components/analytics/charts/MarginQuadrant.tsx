"use client";

import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { ResponsiveChart } from "@/components/analytics/ResponsiveChart";
import { formatMoney } from "@/lib/analytics/currency";

export interface MarginQuadrantPoint {
  clientName: string;
  revenue: number;
  marginPct: number;
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function QuadrantTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload: MarginQuadrantPoint }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div style={tooltipStyle} className="px-3 py-2">
      <p className="font-medium text-foreground">{point.clientName}</p>
      <p className="text-muted-foreground">{formatMoney(point.revenue)} revenue</p>
      <p className="text-muted-foreground">{point.marginPct.toFixed(1)}% margin</p>
    </div>
  );
}

export function MarginQuadrant({ points }: { points: MarginQuadrantPoint[] }) {
  if (!points || points.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No client data for selected period</p>;
  }

  const medianRevenue = median(points.map(p => p.revenue));

  return (
    <ResponsiveChart width="100%" height={280}>
      <ScatterChart margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          type="number"
          dataKey="revenue"
          name="Revenue"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => formatMoney(v)}
        />
        <YAxis
          type="number"
          dataKey="marginPct"
          name="Margin"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}%`}
        />
        <ZAxis type="number" dataKey="revenue" range={[60, 400]} name="Revenue" />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<QuadrantTooltip />} />
        <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
        <ReferenceLine x={medianRevenue} stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <Scatter data={points} fill="hsl(221,83%,53%)" />
      </ScatterChart>
    </ResponsiveChart>
  );
}
