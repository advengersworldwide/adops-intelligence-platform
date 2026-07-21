"use client";

import { Target } from "lucide-react";
import { formatMoney } from "@/lib/analytics/currency";
import { KpiCard } from "@/components/analytics/KpiCard";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useAdjustedSummary } from "@/lib/dashboard/use-adjusted-summary";

export function KpiCost() {
  const { adjustedSummary, isLoading, baseCurrency } = useAdjustedSummary();

  return (
    <DashboardWidget fill={false}>
      <KpiCard
        title="Total Cost"
        value={adjustedSummary ? formatMoney(adjustedSummary.totalCost, baseCurrency) : "$0"}
        delta={adjustedSummary?.costChange}
        positive={(adjustedSummary?.costChange ?? 0) <= 0}
        icon={<Target className="h-4 w-4" />}
        loading={isLoading}
      />
    </DashboardWidget>
  );
}
