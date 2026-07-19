"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { FunnelStage } from "@workspace/api-client-react";
import { formatMoney } from "@/lib/analytics/currency";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "hsl(38,92%,50%)",
  approved: "hsl(221,83%,53%)",
  dispute: "hsl(0,84%,60%)",
};

const COLLECTION_COLOR: Record<string, string> = {
  outstanding: "hsl(0,84%,60%)",
  partial: "hsl(38,92%,50%)",
  paid: "hsl(160,84%,39%)",
};

interface FunnelRowProps {
  title: string;
  stages: FunnelStage[];
  colors: Record<string, string>;
  currency?: string;
}

// One compact horizontal stacked bar (single row) plus a small legend of count + amount per stage.
function FunnelRow({ title, stages, colors, currency }: FunnelRowProps) {
  const data = [Object.fromEntries(stages.map((s) => [s.label, s.count]))];

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ResponsiveContainer width="100%" height={40}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" hide />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(val: number, name: string) => {
              const stage = stages.find((s) => s.label === name);
              return [`${val} · ${formatMoney(stage?.amount ?? 0, currency)}`, name];
            }}
          />
          {stages.map((s) => (
            <Bar
              key={s.label}
              dataKey={s.label}
              stackId="funnel"
              fill={colors[s.label] ?? "hsl(var(--muted-foreground))"}
              name={s.label}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {stages.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: colors[s.label] ?? "hsl(var(--muted-foreground))" }}
            />
            <span className="capitalize text-foreground">{s.label}</span>
            <span className="text-muted-foreground">
              {s.count} · {formatMoney(s.amount, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatusFunnel({
  byStatus,
  byCollection,
  currency,
}: {
  byStatus: FunnelStage[];
  byCollection: FunnelStage[];
  currency?: string;
}) {
  const hasData =
    (byStatus?.some((s) => s.count > 0) ?? false) || (byCollection?.some((s) => s.count > 0) ?? false);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-foreground">Invoice Status Funnel</h2>
      {!hasData ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No invoices for selected period</p>
      ) : (
        <div className="space-y-5">
          <FunnelRow title="By Status" stages={byStatus ?? []} colors={STATUS_COLOR} currency={currency} />
          <FunnelRow title="By Collection" stages={byCollection ?? []} colors={COLLECTION_COLOR} currency={currency} />
        </div>
      )}
    </div>
  );
}
