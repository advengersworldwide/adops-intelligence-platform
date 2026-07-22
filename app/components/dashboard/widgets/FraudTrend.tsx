"use client";
import { useGetFraudQuality } from "@workspace/api-client-react";
import { FraudTrendChart } from "@/components/analytics/charts/FraudTrendChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function FraudTrend() {
  const { data, isLoading } = useGetFraudQuality();
  return (
    <DashboardWidget title="Traffic quality" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <FraudTrendChart points={data ?? []} />
    </DashboardWidget>
  );
}
