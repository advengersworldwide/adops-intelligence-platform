"use client";
import { useGetAnomalies } from "@workspace/api-client-react";
import { AnomalyChart } from "@/components/analytics/charts/AnomalyChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function Anomalies() {
  const { data, isLoading } = useGetAnomalies();
  return (
    <DashboardWidget title="Anomaly watch" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <AnomalyChart points={data ?? []} />
    </DashboardWidget>
  );
}
