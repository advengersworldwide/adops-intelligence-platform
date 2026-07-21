"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { ResponsiveChart } from "@/components/analytics/ResponsiveChart";
import type { FraudPoint } from "@workspace/api-client-react";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export function FraudTrendChart({
  points,
  thresholdPct = 10,
}: {
  points: FraudPoint[];
  thresholdPct?: number;
}) {
  if (!points || points.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No data for selected period</p>;
  }

  return (
    <ResponsiveChart width="100%" height={320}>
      <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="period"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
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
            name === "Fraud Rate %" ? [`${val.toFixed(1)}%`, name] : [val, name]
          }
        />
        <Legend wrapperStyle={{ fontSize: "12px" }} />
        <ReferenceLine
          yAxisId="right"
          y={thresholdPct}
          stroke="hsl(38,92%,50%)"
          strokeDasharray="4 4"
          label={{ value: `Threshold ${thresholdPct}%`, position: "insideTopRight", fontSize: 10, fill: "hsl(38,92%,50%)" }}
        />
        <Bar yAxisId="left" dataKey="validPins" stackId="pins" fill="hsl(160,84%,39%)" radius={[0, 0, 0, 0]} name="Valid Pins" />
        <Bar yAxisId="left" dataKey="fraudPins" stackId="pins" fill="hsl(0,84%,60%)" radius={[3, 3, 0, 0]} name="Fraud Pins" />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="fraudRatePct"
          stroke="hsl(0,84%,60%)"
          strokeWidth={2}
          dot={false}
          name="Fraud Rate %"
        />
      </ComposedChart>
    </ResponsiveChart>
  );
}
