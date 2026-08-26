"use client";

import { useGetInvoiceFunnel } from "@workspace/api-client-react";
import { StatusFunnel } from "@/components/analytics/charts/StatusFunnel";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useDashboardRange } from "@/lib/dashboard/range-context";

export function InvoiceFunnel() {
  const range = useDashboardRange();
  const { data, isLoading } = useGetInvoiceFunnel(range as never);
  return (
    <DashboardWidget title="Invoice status" loading={isLoading} isEmpty={!isLoading && !data?.byStatus?.length}>
      <StatusFunnel flat byStatus={data?.byStatus ?? []} byCollection={data?.byCollection ?? []} />
    </DashboardWidget>
  );
}
