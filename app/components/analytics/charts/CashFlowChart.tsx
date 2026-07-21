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
} from "recharts";
import { ResponsiveChart } from "@/components/analytics/ResponsiveChart";
import type { CashFlowBucket } from "@workspace/api-client-react";
import { runningBalance, type CashFlowInput } from "@/lib/analytics/cashflow";
import { convertTo, formatMoney, DEFAULT_RATES } from "@/lib/analytics/currency";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export function CashFlowChart({ buckets }: { buckets: CashFlowBucket[] }) {
  if (!buckets || buckets.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No data for selected period</p>;
  }

  const baseCurrency = typeof window !== "undefined" ? (localStorage.getItem("adops-base-currency") || "USD") : "USD";
  const rawRates = typeof window !== "undefined" ? localStorage.getItem("adops-exchange-rates") : null;
  const exchangeRates = rawRates ? JSON.parse(rawRates) : DEFAULT_RATES;

  const rows: CashFlowInput[] = buckets.map((b) => ({
    date: b.date,
    inflow: convertTo(b.inflowPkr, "PKR", exchangeRates),
    outflow: convertTo(b.outflowUsd, "USD", exchangeRates),
    fundedOut: convertTo(b.fundedOutUsd, "USD", exchangeRates),
    unfundedOut: convertTo(b.unfundedOutUsd, "USD", exchangeRates),
  }));

  const data = runningBalance(rows);

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
          tickFormatter={(v: number) => formatMoney(v, baseCurrency)}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(val: number, name: string) => [formatMoney(val, baseCurrency), name]}
        />
        <Legend wrapperStyle={{ fontSize: "12px" }} />
        <Bar dataKey="inflow" fill="hsl(160,84%,39%)" radius={[3, 3, 0, 0]} name="Money In" />
        <Bar dataKey="fundedOut" stackId="out" fill="hsl(0,84%,60%)" radius={[0, 0, 0, 0]} name="Funded Payout" />
        <Bar dataKey="unfundedOut" stackId="out" fill="hsl(38,92%,50%)" radius={[3, 3, 0, 0]} name="Unfunded Payout" />
        <Line type="monotone" dataKey="balance" stroke="hsl(221,83%,53%)" strokeWidth={2} dot={false} name="Running Balance" />
      </ComposedChart>
    </ResponsiveChart>
  );
}
