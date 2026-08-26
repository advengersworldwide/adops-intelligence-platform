"use client";
import { useGetProfitWaterfall } from "@workspace/api-client-react";
import { WaterfallChart } from "@/components/analytics/charts/WaterfallChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useDashboardRange } from "@/lib/dashboard/range-context";

export function ProfitWaterfall() {
  const range = useDashboardRange();
  const { data, isLoading } = useGetProfitWaterfall(range as never);
  return (
    <DashboardWidget title="Profit leakage" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <WaterfallChart stages={(data ?? []) as never} />
    </DashboardWidget>
  );
}
