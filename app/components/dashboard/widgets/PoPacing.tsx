"use client";

import { useGetPoPacing } from "@workspace/api-client-react";
import { PoBurnDownChart } from "@/components/analytics/charts/PoBurnDownChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useDashboardRange } from "@/lib/dashboard/range-context";

export function PoPacing() {
  const range = useDashboardRange();
  const { data, isLoading } = useGetPoPacing(range as never);
  return (
    <DashboardWidget title="PO pacing" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <PoBurnDownChart flat pos={data ?? []} />
    </DashboardWidget>
  );
}
