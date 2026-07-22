"use client";

import { useGetInvoiceFunnel } from "@workspace/api-client-react";
import { StatusFunnel } from "@/components/analytics/charts/StatusFunnel";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function InvoiceFunnel() {
  const { data, isLoading } = useGetInvoiceFunnel();
  return (
    <DashboardWidget title="Invoice status" loading={isLoading} isEmpty={!isLoading && !data?.byStatus?.length}>
      <StatusFunnel byStatus={data?.byStatus ?? []} byCollection={data?.byCollection ?? []} />
    </DashboardWidget>
  );
}
