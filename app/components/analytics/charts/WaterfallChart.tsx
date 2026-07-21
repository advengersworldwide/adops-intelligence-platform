"use client";

import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ResponsiveChart } from "@/components/analytics/ResponsiveChart";
import type { WaterfallStage } from "@/lib/analytics/waterfall";
import { formatMoney } from "@/lib/analytics/currency";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

const KIND_COLOR: Record<WaterfallStage["kind"], string> = {
  start: "hsl(221,83%,53%)",
  subtotal: "hsl(221,83%,53%)",
  total: "hsl(160,84%,39%)",
  decrease: "hsl(0,84%,60%)",
};

interface WaterfallRow {
  label: string;
  base: number;
  bar: number;
  kind: WaterfallStage["kind"];
  value: number;
}

/** Walk stages with a running total so decrease bars float between the pre/post running total. */
function buildRows(stages: WaterfallStage[]): WaterfallRow[] {
  let running = 0;
  return stages.map((stage) => {
    if (stage.kind === "decrease") {
      const next = running - stage.value;
      const row: WaterfallRow = { label: stage.label, base: next, bar: stage.value, kind: stage.kind, value: stage.value };
      running = next;
      return row;
    }
    // start, subtotal, total: full-height bar from zero.
    const row: WaterfallRow = { label: stage.label, base: 0, bar: stage.value, kind: stage.kind, value: stage.value };
    if (stage.kind === "start") running = stage.value;
    return row;
  });
}

export function WaterfallChart({ stages, currency }: { stages: WaterfallStage[]; currency?: string }) {
  if (!stages || stages.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No data</p>;
  }

  const rows = buildRows(stages);

  return (
    <ResponsiveChart width="100%" height={280}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          angle={-25}
          textAnchor="end"
          height={50}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => formatMoney(v, currency)}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(_val: number, _name: string, item: { payload?: WaterfallRow }) => [
            formatMoney(item.payload?.value ?? 0, currency),
            "Value",
          ]}
        />
        <Bar dataKey="base" stackId="a" fill="transparent" />
        <Bar dataKey="bar" stackId="a" radius={[3, 3, 0, 0]}>
          {rows.map((row) => (
            <Cell key={row.label} fill={KIND_COLOR[row.kind]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveChart>
  );
}
