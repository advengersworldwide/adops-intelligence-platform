"use client";

import { useGetAging } from "@workspace/api-client-react";
import { AgingBars } from "@/components/analytics/charts/AgingBars";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useDashboardRange } from "@/lib/dashboard/range-context";

const empty = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };

export function Aging() {
  const range = useDashboardRange();
  const { data, isLoading } = useGetAging(range as never);
  return (
    <DashboardWidget title="AR / AP aging" loading={isLoading} isEmpty={!isLoading && !data}>
      <div className="grid h-full grid-rows-2 gap-3 min-h-0">
        <AgingBars flat buckets={data?.ar ?? empty} title="Receivables (AR)" />
        <AgingBars flat buckets={data?.ap ?? empty} title="Payables (AP)" />
      </div>
    </DashboardWidget>
  );
}
