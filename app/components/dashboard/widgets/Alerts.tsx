"use client";

import { AlertTriangle } from "lucide-react";
import { useGetAlerts } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function Alerts() {
  const { data: alerts, isLoading } = useGetAlerts();
  const hasAlerts = !!alerts && alerts.length > 0;

  // Most severe first (critical before warning); order is otherwise preserved.
  const sorted = [...(alerts ?? [])].sort(
    (a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1),
  );

  return (
    <DashboardWidget title="Alerts" loading={isLoading} isEmpty={!isLoading && !hasAlerts} emptyLabel="No active alerts">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 mb-3 -mt-1 shrink-0">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          {hasAlerts && (
            <Badge variant="destructive" className="ml-auto text-xs">{sorted.length}</Badge>
          )}
        </div>
        <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
          {sorted.map(a => {
            const title = a.label ?? a.campaignName ?? a.message;
            return (
              <div key={a.id} className={cn(
                "rounded-lg p-2.5 text-xs",
                a.severity === "critical" ? "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400" : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400"
              )}>
                <p className="font-medium">{title}</p>
                {title !== a.message && (
                  <p className="text-[10px] opacity-80 mt-0.5">{a.message}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </DashboardWidget>
  );
}
