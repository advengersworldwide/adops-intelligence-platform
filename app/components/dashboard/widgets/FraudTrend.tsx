"use client";
import { useGetFraudQuality } from "@workspace/api-client-react";
import { FraudTrendChart } from "@/components/analytics/charts/FraudTrendChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useDashboardRange } from "@/lib/dashboard/range-context";

export function FraudTrend() {
  const range = useDashboardRange();
  const { data, isLoading } = useGetFraudQuality(range as never);
  return (
    <DashboardWidget title="Traffic quality" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <FraudTrendChart points={data ?? []} />
    </DashboardWidget>
  );
}
