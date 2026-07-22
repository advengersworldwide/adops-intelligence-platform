"use client";

import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ResponsiveChart } from "@/components/analytics/ResponsiveChart";
import type { AgingBuckets } from "@/lib/analytics/aging";
import { formatMoney } from "@/lib/analytics/currency";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

// Recent -> old: green, amber, orange, red.
const BUCKET_COLOR: Record<keyof AgingBuckets, string> = {
  "0-30": "hsl(160,84%,39%)",
  "31-60": "hsl(48,96%,53%)",
  "61-90": "hsl(25,95%,53%)",
  "90+": "hsl(0,84%,60%)",
};

const BUCKET_ORDER: (keyof AgingBuckets)[] = ["0-30", "31-60", "61-90", "90+"];

export function AgingBars({ buckets, currency, title }: { buckets: AgingBuckets; currency?: string; title?: string }) {
  const rows = BUCKET_ORDER.map((bucket) => ({ bucket, amount: buckets[bucket] }));
  const hasData = rows.some((r) => r.amount > 0);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      {title ? <h2 className="mb-4 text-sm font-semibold text-foreground">{title}</h2> : null}
      {!hasData ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No outstanding balances for selected period</p>
      ) : (
        <>
        <ResponsiveChart width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
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
              formatter={(val: number) => [formatMoney(val, currency), "Outstanding"]}
            />
            <Bar dataKey="amount" radius={[3, 3, 0, 0]} name="Outstanding">
              {rows.map((row) => (
                <Cell key={row.bucket} fill={BUCKET_COLOR[row.bucket]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveChart>
        <div className="mt-2 flex flex-wrap justify-center gap-3 text-[10px] text-muted-foreground">
          {BUCKET_ORDER.map((b) => (
            <span key={b} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: BUCKET_COLOR[b] }} />
              {b} days
            </span>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
