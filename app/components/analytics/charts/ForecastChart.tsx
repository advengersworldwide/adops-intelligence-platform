"use client";

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ResponsiveChart } from "@/components/analytics/ResponsiveChart";
import { formatMoney } from "@/lib/analytics/currency";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

interface ForecastChartRow {
  date: string;
  actual?: number;
  projected?: number;
  lower?: number;
  upper?: number;
}

export function ForecastChart({
  history,
  forecast,
  currency,
}: {
  history: { date: string; value: number }[];
  forecast: { date: string; value: number; lower: number; upper: number }[];
  currency?: string;
}) {
  if ((!history || history.length === 0) && (!forecast || forecast.length === 0)) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No data for selected period</p>;
  }

  const data: ForecastChartRow[] = [
    ...history.map((h) => ({ date: h.date, actual: h.value })),
    ...forecast.map((f) => ({ date: f.date, projected: f.value, lower: f.lower, upper: f.upper })),
  ];

  return (
    <ResponsiveChart width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => formatMoney(v, currency)}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(val, name) => {
            if (Array.isArray(val)) {
              return [`${formatMoney(Number(val[0]), currency)} - ${formatMoney(Number(val[1]), currency)}`, name];
            }
            return [formatMoney(Number(val), currency), name];
          }}
        />
        <Legend wrapperStyle={{ fontSize: "12px" }} />
        <Area
          dataKey={(d: ForecastChartRow) => (d.lower != null && d.upper != null ? [d.lower, d.upper] : null)}
          stroke="none"
          fill="hsl(221,83%,53%)"
          fillOpacity={0.12}
          name="Confidence band"
          legendType="none"
          isAnimationActive={false}
        />
        <Line type="monotone" dataKey="actual" stroke="hsl(221,83%,53%)" strokeWidth={2} dot={false} name="Actual" />
        <Line
          type="monotone"
          dataKey="projected"
          stroke="hsl(221,83%,53%)"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
          name="Projected"
        />
      </ComposedChart>
    </ResponsiveChart>
  );
}
