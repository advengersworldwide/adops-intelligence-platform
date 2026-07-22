"use client";
import { useGetMarginMatrix } from "@workspace/api-client-react";
import { RevenueTreemap } from "@/components/analytics/charts/RevenueTreemap";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function RevenueMix() {
  const { data, isLoading } = useGetMarginMatrix();
  return (
    <DashboardWidget title="Revenue mix" loading={isLoading} isEmpty={!isLoading && !data?.cells?.length}>
      <RevenueTreemap cells={data?.cells ?? []} />
    </DashboardWidget>
  );
}
