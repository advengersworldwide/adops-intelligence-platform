"use client";
import { useGetMarginMatrix } from "@workspace/api-client-react";
import { RevenueTreemap } from "@/components/analytics/charts/RevenueTreemap";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useDashboardRange } from "@/lib/dashboard/range-context";

export function RevenueMix() {
  const range = useDashboardRange();
  const { data, isLoading } = useGetMarginMatrix(range as never);
  return (
    <DashboardWidget title="Revenue mix" loading={isLoading} isEmpty={!isLoading && !data?.cells?.length}>
      <RevenueTreemap cells={data?.cells ?? []} />
    </DashboardWidget>
  );
}
