"use client";

import { useGetCashFlow } from "@workspace/api-client-react";
import { CashFlowChart } from "@/components/analytics/charts/CashFlowChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useDashboardRange } from "@/lib/dashboard/range-context";

export function CashFlow() {
  const range = useDashboardRange();
  const { data, isLoading } = useGetCashFlow(range as never);
  return (
    <DashboardWidget title="Cash flow" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <CashFlowChart buckets={data ?? []} />
    </DashboardWidget>
  );
}
