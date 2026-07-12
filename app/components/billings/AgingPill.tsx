"use client";

import { computeAging } from "@/lib/aging";
import { cn } from "@/lib/utils";

const PILL: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  yellow: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  neutral: "bg-muted text-muted-foreground",
};

export function AgingPill({ start, termDays, settled }: { start: string | null; termDays: number | null; settled: boolean }) {
  const a = computeAging({ start: start ? new Date(start) : null, termDays, now: new Date(), settled });
  const label = settled ? "Settled"
    : a.color === "neutral" ? "—"
    : a.overdue ? `Overdue ${Math.abs(a.daysLeft ?? 0)}d`
    : `${a.daysLeft}d left`;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", PILL[a.color])}>
      {label}
    </span>
  );
}
