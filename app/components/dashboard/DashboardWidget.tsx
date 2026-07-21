"use client";

import { GripHorizontal } from "lucide-react";
import { WidgetErrorBoundary } from "@/components/analytics/WidgetErrorBoundary";
import { Skeleton } from "@/components/ui/skeleton";

export interface DashboardWidgetProps {
  title?: string;
  loading?: boolean;
  isEmpty?: boolean;
  emptyLabel?: string;
  /** When false, the body area does not stretch (KPI tiles). Charts pass true. */
  fill?: boolean;
  children: React.ReactNode;
}

export function DashboardWidget({
  title, loading, isEmpty, emptyLabel = "No data yet", fill = true, children,
}: DashboardWidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex shrink-0 cursor-grab items-center justify-center border-b border-border bg-muted/10 p-1 active:cursor-grabbing widget-drag-handle">
        <GripHorizontal className="h-3 w-3 text-muted-foreground/50" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        {title && <h3 className="mb-3 shrink-0 text-sm font-semibold text-foreground">{title}</h3>}
        <div className={fill ? "min-h-0 flex-1" : ""}>
          <WidgetErrorBoundary title={title ?? "Widget"}>
            {loading ? (
              <Skeleton className="h-full min-h-[80px] w-full" />
            ) : isEmpty ? (
              <div className="flex h-full min-h-[80px] items-center justify-center text-sm text-muted-foreground">
                {emptyLabel}
              </div>
            ) : (
              children
            )}
          </WidgetErrorBoundary>
        </div>
      </div>
    </div>
  );
}