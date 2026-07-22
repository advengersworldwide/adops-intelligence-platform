"use client";
import { useGetProfitWaterfall } from "@workspace/api-client-react";
import { WaterfallChart } from "@/components/analytics/charts/WaterfallChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function ProfitWaterfall() {
  const { data, isLoading } = useGetProfitWaterfall();
  return (
    <DashboardWidget title="Profit leakage" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <WaterfallChart stages={(data ?? []) as never} />
    </DashboardWidget>
  );
}
