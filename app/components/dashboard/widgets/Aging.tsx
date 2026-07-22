"use client";

import { useGetAging } from "@workspace/api-client-react";
import { AgingBars } from "@/components/analytics/charts/AgingBars";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

const empty = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };

export function Aging() {
  const { data, isLoading } = useGetAging();
  return (
    <DashboardWidget title="AR / AP aging" loading={isLoading} isEmpty={!isLoading && !data}>
      <div className="grid h-full grid-rows-2 gap-3">
        <AgingBars buckets={data?.ar ?? empty} title="Receivables (AR)" />
        <AgingBars buckets={data?.ap ?? empty} title="Payables (AP)" />
      </div>
    </DashboardWidget>
  );
}
