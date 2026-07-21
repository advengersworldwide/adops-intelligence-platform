"use client";

import { useId } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { AreaChart, Area } from "recharts";
import { ResponsiveChart } from "@/components/analytics/ResponsiveChart";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export interface KpiCardProps {
  title: string;
  value: string;
  delta?: number | null;
  positive?: boolean;
  sparkline?: number[];
  loading?: boolean;
  icon?: React.ReactNode;
}

export function KpiCard({ title, value, delta, positive, sparkline, loading, icon }: KpiCardProps) {
  const rawId = useId();
  const gradientId = `kpi-spark-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const hasDelta = delta != null;
  const hasSparkline = !!sparkline?.length;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-28" />
          ) : (
            <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{value}</p>
          )}
          {hasDelta && !loading && (
            <div
              className={cn(
                "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                positive
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                  : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
              )}
            >
              {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`}
            </div>
          )}
        </div>
        {icon && <div className="rounded-xl bg-primary/10 p-2.5 text-primary">{icon}</div>}
      </div>

      {hasSparkline && !loading && (
        <div className="mt-3 h-10 w-full">
          <ResponsiveChart width="100%" height="100%">
            <AreaChart data={sparkline.map((v, i) => ({ i, v }))} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(221,83%,53%)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="hsl(221,83%,53%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke="hsl(221,83%,53%)"
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
              />
            </AreaChart>
          </ResponsiveChart>
        </div>
      )}
    </div>
  );
}
