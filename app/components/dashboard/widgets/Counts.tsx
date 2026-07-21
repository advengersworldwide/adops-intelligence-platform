"use client";

import { Users, Monitor, Megaphone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useAdjustedSummary } from "@/lib/dashboard/use-adjusted-summary";

export function Counts() {
  const { adjustedSummary, isLoading } = useAdjustedSummary();

  return (
    <DashboardWidget fill={false}>
      <div className="grid grid-cols-3 gap-4 items-center">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-50 dark:bg-blue-950 p-2.5 text-blue-600"><Users className="h-4 w-4" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Clients</p>
            {isLoading ? <Skeleton className="h-5 w-8 mt-1" /> : <p className="font-bold text-lg text-foreground">{adjustedSummary?.clientCount ?? 0}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-purple-50 dark:bg-purple-950 p-2.5 text-purple-600"><Monitor className="h-4 w-4" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Platforms</p>
            {isLoading ? <Skeleton className="h-5 w-8 mt-1" /> : <p className="font-bold text-lg text-foreground">{adjustedSummary?.platformCount ?? 0}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-orange-50 dark:bg-orange-950 p-2.5 text-orange-600"><Megaphone className="h-4 w-4" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Campaigns</p>
            {isLoading ? <Skeleton className="h-5 w-8 mt-1" /> : <p className="font-bold text-lg text-foreground">{adjustedSummary?.campaignCount ?? 0}</p>}
          </div>
        </div>
      </div>
    </DashboardWidget>
  );
}
