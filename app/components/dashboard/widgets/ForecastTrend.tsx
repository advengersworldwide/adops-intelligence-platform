"use client";
import { useGetForecast } from "@workspace/api-client-react";
import { ForecastChart } from "@/components/analytics/charts/ForecastChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useDashboardRange } from "@/lib/dashboard/range-context";

export function ForecastTrend() {
  const range = useDashboardRange();
  const { data, isLoading } = useGetForecast(range as never);
  return (
    <DashboardWidget title="Profit trend & forecast" loading={isLoading} isEmpty={!isLoading && !data?.history?.length}>
      <ForecastChart history={data?.history ?? []} forecast={data?.forecast ?? []} />
    </DashboardWidget>
  );
}
