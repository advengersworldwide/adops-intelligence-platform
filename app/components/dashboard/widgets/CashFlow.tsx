"use client";

import { useGetCashFlow } from "@workspace/api-client-react";
import { CashFlowChart } from "@/components/analytics/charts/CashFlowChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function CashFlow() {
  const { data, isLoading } = useGetCashFlow();
  return (
    <DashboardWidget title="Cash flow" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <CashFlowChart buckets={data ?? []} />
    </DashboardWidget>
  );
}
