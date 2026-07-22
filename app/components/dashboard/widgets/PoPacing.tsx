"use client";

import { useGetPoPacing } from "@workspace/api-client-react";
import { PoBurnDownChart } from "@/components/analytics/charts/PoBurnDownChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function PoPacing() {
  const { data, isLoading } = useGetPoPacing();
  return (
    <DashboardWidget title="PO pacing" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <PoBurnDownChart pos={data ?? []} />
    </DashboardWidget>
  );
}
