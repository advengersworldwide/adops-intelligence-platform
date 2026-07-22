"use client";
import { useGetConcentration } from "@workspace/api-client-react";
import { ParetoChart } from "@/components/analytics/charts/ParetoChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function Concentration() {
  const { data, isLoading } = useGetConcentration();
  return (
    <DashboardWidget title="Revenue concentration" loading={isLoading} isEmpty={!isLoading && !data?.points?.length}>
      <ParetoChart points={data?.points ?? []} hhi={data?.hhi} top5Pct={data?.top5Pct} />
    </DashboardWidget>
  );
}
