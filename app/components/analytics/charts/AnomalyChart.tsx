"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ResponsiveChart } from "@/components/analytics/ResponsiveChart";
import { formatMoney } from "@/lib/analytics/currency";

export interface AnomalyChartPoint {
  date: string;
  value: number;
  z: number;
  isAnomaly: boolean;
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

function AnomalyTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: AnomalyChartPoint }>;
  label?: string;
  currency?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div style={tooltipStyle} className="px-3 py-2">
      <p className="font-medium text-foreground">{label}</p>
      <p className="text-muted-foreground">{formatMoney(point.value, currency)}</p>
      <p className="text-muted-foreground">z = {point.z.toFixed(2)}</p>
      {point.isAnomaly && <p className="font-medium" style={{ color: "hsl(0,84%,60%)" }}>⚠ anomaly</p>}
    </div>
  );
}

// Custom dot renderer: anomalous points get a larger red circle, everything
// else gets no visible dot (r=0) so the line stays clean.
function anomalyDot(props: { cx?: number; cy?: number; index?: number; payload?: AnomalyChartPoint }) {
  const { cx, cy, index, payload } = props;
  if (payload?.isAnomaly) {
    return <circle key={`anomaly-dot-${index}`} cx={cx} cy={cy} r={5} fill="hsl(0,84%,60%)" stroke="hsl(0,84%,60%)" />;
  }
  return <circle key={`anomaly-dot-${index}`} cx={cx} cy={cy} r={0} fill="none" stroke="none" />;
}

export function AnomalyChart({ points, currency }: { points: AnomalyChartPoint[]; currency?: string }) {
  if (!points || points.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No data for selected period</p>;
  }

  return (
    <ResponsiveChart width="100%" height={320}>
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
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
        <Tooltip content={<AnomalyTooltip currency={currency} />} />
        <Legend wrapperStyle={{ fontSize: "12px" }} />
        <Line
          type="monotone"
          dataKey="value"
          stroke="hsl(221,83%,53%)"
          strokeWidth={2}
          dot={anomalyDot}
          name="Value"
        />
      </LineChart>
    </ResponsiveChart>
  );
}
