"use client";
import { useGetAiInsights } from "@workspace/api-client-react";
import { AiInsightStrip } from "@/components/analytics/AiInsightStrip";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function AiInsights() {
  const { data, isLoading } = useGetAiInsights();
  return (
    <DashboardWidget title="What changed" loading={isLoading} isEmpty={!isLoading && (!data || data.length === 0)}>
      <AiInsightStrip insights={data ?? []} />
    </DashboardWidget>
  );
}
