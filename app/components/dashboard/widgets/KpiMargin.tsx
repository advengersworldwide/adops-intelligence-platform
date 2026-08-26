"use client";

import { BarChart2 } from "lucide-react";
import { KpiCard } from "@/components/analytics/KpiCard";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useAdjustedSummary } from "@/lib/dashboard/use-adjusted-summary";

export function KpiMargin() {
  const { adjustedSummary, isLoading } = useAdjustedSummary();

  return (
    <DashboardWidget fill={false}>
      <KpiCard
        flat
        title="Margin %"
        value={adjustedSummary ? `${adjustedSummary.marginPct.toFixed(1)}%` : "0%"}
        icon={<BarChart2 className="h-4 w-4" />}
        loading={isLoading}
      />
    </DashboardWidget>
  );
}
