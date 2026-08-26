"use client";

import { TrendingUp } from "lucide-react";
import { useGetProfitOverTime } from "@workspace/api-client-react";
import { formatMoney } from "@/lib/analytics/currency";
import { KpiCard } from "@/components/analytics/KpiCard";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useAdjustedSummary } from "@/lib/dashboard/use-adjusted-summary";
import { useDashboardRange } from "@/lib/dashboard/range-context";

export function KpiProfit() {
  const { adjustedSummary, isLoading, baseCurrency } = useAdjustedSummary();
  const range = useDashboardRange();
  const { data: profitTimeSeries } = useGetProfitOverTime(range as never);

  return (
    <DashboardWidget fill={false}>
      <KpiCard
        flat
        title="Total Profit"
        value={adjustedSummary ? formatMoney(adjustedSummary.totalProfit, baseCurrency) : formatMoney(0, baseCurrency)}
        delta={adjustedSummary?.profitChange}
        positive={(adjustedSummary?.profitChange ?? 0) >= 0}
        sparkline={profitTimeSeries?.map(p => p.profit)}
        icon={<TrendingUp className="h-4 w-4" />}
        loading={isLoading}
      />
    </DashboardWidget>
  );
}
