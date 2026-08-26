"use client";
import { useGetAnomalies } from "@workspace/api-client-react";
import { AnomalyChart } from "@/components/analytics/charts/AnomalyChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useDashboardRange } from "@/lib/dashboard/range-context";

export function Anomalies() {
  const range = useDashboardRange();
  const { data, isLoading } = useGetAnomalies(range as never);
  return (
    <DashboardWidget title="Anomaly watch" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <AnomalyChart points={data ?? []} />
    </DashboardWidget>
  );
}
