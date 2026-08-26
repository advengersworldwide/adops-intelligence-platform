"use client";
import { useGetConcentration } from "@workspace/api-client-react";
import { ParetoChart } from "@/components/analytics/charts/ParetoChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useDashboardRange } from "@/lib/dashboard/range-context";

export function Concentration() {
  const range = useDashboardRange();
  const { data, isLoading } = useGetConcentration(range as never);
  return (
    <DashboardWidget title="Revenue concentration" loading={isLoading} isEmpty={!isLoading && !data?.points?.length}>
      <ParetoChart points={data?.points ?? []} hhi={data?.hhi} top5Pct={data?.top5Pct} />
    </DashboardWidget>
  );
}
