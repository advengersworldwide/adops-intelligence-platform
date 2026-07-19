"use client";

import {
  useGetAging,
  useGetCashFlow,
  useGetInvoiceFunnel,
  useGetPoPacing,
} from "@workspace/api-client-react";
import { useAnalyticsFilters } from "@/hooks/use-analytics-filters";
import { buildAnalyticsParams } from "@/lib/analytics/filters";
import { WidgetErrorBoundary } from "@/components/analytics/WidgetErrorBoundary";
import { AgingBars } from "@/components/analytics/charts/AgingBars";
import { CashFlowChart } from "@/components/analytics/charts/CashFlowChart";
import { StatusFunnel } from "@/components/analytics/charts/StatusFunnel";
import { PoBurnDownChart } from "@/components/analytics/charts/PoBurnDownChart";
import { Skeleton } from "@/components/ui/skeleton";

const emptyBuckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };

export function FinancialOpsTab() {
  const { filters } = useAnalyticsFilters();
  const params = buildAnalyticsParams(filters);

  const { data: aging, isLoading: agingLoading } = useGetAging(params as never);
  const { data: cashflow, isLoading: cashflowLoading } = useGetCashFlow(params as never);
  const { data: funnel, isLoading: funnelLoading } = useGetInvoiceFunnel(params as never);
  const { data: poPacing, isLoading: poPacingLoading } = useGetPoPacing(params as never);

  return (
    <div className="space-y-6">
      {/* AR / AP aging */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WidgetErrorBoundary title="Receivables Aging">
          {agingLoading ? (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <Skeleton className="h-56 w-full" />
            </div>
          ) : (
            <AgingBars buckets={aging?.ar ?? emptyBuckets} title="Receivables (AR)" />
          )}
        </WidgetErrorBoundary>

        <WidgetErrorBoundary title="Payables Aging">
          {agingLoading ? (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <Skeleton className="h-56 w-full" />
            </div>
          ) : (
            <AgingBars buckets={aging?.ap ?? emptyBuckets} title="Payables (AP)" />
          )}
        </WidgetErrorBoundary>
      </div>

      {/* Cash-flow timeline */}
      <WidgetErrorBoundary title="Cash Flow Timeline">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Cash Flow Timeline</h2>
          {cashflowLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <CashFlowChart buckets={cashflow ?? []} />
          )}
        </div>
      </WidgetErrorBoundary>

      {/* Invoice status funnel + PO burn-down pacing */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WidgetErrorBoundary title="Invoice Status Funnel">
          {funnelLoading ? (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <StatusFunnel byStatus={funnel?.byStatus ?? []} byCollection={funnel?.byCollection ?? []} />
          )}
        </WidgetErrorBoundary>

        <WidgetErrorBoundary title="PO Burn-Down Pacing">
          {poPacingLoading ? (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <PoBurnDownChart pos={poPacing ?? []} />
          )}
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}
