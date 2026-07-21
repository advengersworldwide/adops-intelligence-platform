"use client";

import { DollarSign } from "lucide-react";
import { useGetProfitOverTime } from "@workspace/api-client-react";
import { formatMoney } from "@/lib/analytics/currency";
import { KpiCard } from "@/components/analytics/KpiCard";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useAdjustedSummary } from "@/lib/dashboard/use-adjusted-summary";

export function KpiRevenue() {
  const { adjustedSummary, isLoading, baseCurrency } = useAdjustedSummary();
  const { data: profitTimeSeries } = useGetProfitOverTime();

  return (
    <DashboardWidget fill={false}>
      <KpiCard
        title="Total Revenue"
        value={adjustedSummary ? formatMoney(adjustedSummary.totalRevenue, baseCurrency) : "$0"}
        delta={adjustedSummary?.revenueChange}
        positive={(adjustedSummary?.revenueChange ?? 0) >= 0}
        sparkline={profitTimeSeries?.map(p => p.revenue)}
        icon={<DollarSign className="h-4 w-4" />}
        loading={isLoading}
      />
    </DashboardWidget>
  );
}
