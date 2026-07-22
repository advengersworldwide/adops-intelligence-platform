"use client";
import { useGetAnalyticsByClient } from "@workspace/api-client-react";
import { MarginQuadrant } from "@/components/analytics/charts/MarginQuadrant";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function MarginQuadrantWidget() {
  const { data, isLoading } = useGetAnalyticsByClient();
  return (
    <DashboardWidget title="Revenue × margin" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <MarginQuadrant points={(data ?? []).map((c) => ({ clientName: c.clientName, revenue: c.revenue, marginPct: c.marginPct }))} />
    </DashboardWidget>
  );
}
