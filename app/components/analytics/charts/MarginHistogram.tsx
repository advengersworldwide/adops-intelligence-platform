"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { ResponsiveChart } from "@/components/analytics/ResponsiveChart";
import type { MarginBucket } from "@/lib/analytics/distribution";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export function MarginHistogram({ buckets }: { buckets: MarginBucket[] }) {
  if (!buckets || buckets.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No margin data for selected period</p>;
  }

  return (
    <>
    <ResponsiveChart width="100%" height={220}>
      <BarChart data={buckets} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} formatter={(val: number) => [val, "Campaigns"]} />
        <Bar dataKey="count" radius={[3, 3, 0, 0]} name="Campaigns">
          {buckets.map((bucket, index) => (
            <Cell key={bucket.label ?? index} fill={bucket.isNegative ? "hsl(0,84%,60%)" : "hsl(221,83%,53%)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveChart>
    <div className="mt-2 flex flex-wrap justify-center gap-3 text-[10px] text-muted-foreground">
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "hsl(221,83%,53%)" }} /> Positive margin</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "hsl(0,84%,60%)" }} /> Negative margin</span>
    </div>
    </>
  );
}
