"use client";
import { useGetForecast } from "@workspace/api-client-react";
import { ForecastChart } from "@/components/analytics/charts/ForecastChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function ForecastTrend() {
  const { data, isLoading } = useGetForecast();
  return (
    <DashboardWidget title="Profit trend & forecast" loading={isLoading} isEmpty={!isLoading && !data?.history?.length}>
      <ForecastChart history={data?.history ?? []} forecast={data?.forecast ?? []} />
    </DashboardWidget>
  );
}
