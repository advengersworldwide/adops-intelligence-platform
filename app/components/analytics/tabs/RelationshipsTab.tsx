"use client";

import {
  useGetConcentration,
  useGetMoneyFlow,
  useGetMarginMatrix,
  useGetFraudQuality,
} from "@workspace/api-client-react";
import { useAnalyticsFilters } from "@/hooks/use-analytics-filters";
import { buildAnalyticsParams } from "@/lib/analytics/filters";
import { WidgetErrorBoundary } from "@/components/analytics/WidgetErrorBoundary";
import { ParetoChart } from "@/components/analytics/charts/ParetoChart";
import { FlowSankey } from "@/components/analytics/charts/FlowSankey";
import { MarginHeatmap } from "@/components/analytics/charts/MarginHeatmap";
import { RevenueTreemap } from "@/components/analytics/charts/RevenueTreemap";
import { FraudTrendChart } from "@/components/analytics/charts/FraudTrendChart";
import { Skeleton } from "@/components/ui/skeleton";

export function RelationshipsTab() {
  const { filters } = useAnalyticsFilters();
  const params = buildAnalyticsParams(filters);

  const { data: concentration, isLoading: concentrationLoading } = useGetConcentration(params as never);
  const { data: flow, isLoading: flowLoading } = useGetMoneyFlow(params as never);
  const { data: matrix, isLoading: matrixLoading } = useGetMarginMatrix(params as never);
  const { data: fraud, isLoading: fraudLoading } = useGetFraudQuality(params as never);

  return (
    <div className="space-y-6">
      {/* Client concentration (Pareto) */}
      <WidgetErrorBoundary title="Client Concentration">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Client Concentration</h2>
          {concentrationLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <ParetoChart
              points={concentration?.points ?? []}
              hhi={concentration?.hhi}
              top5Pct={concentration?.top5Pct}
            />
          )}
        </div>
      </WidgetErrorBoundary>

      {/* Money flow (Sankey) */}
      <WidgetErrorBoundary title="Money Flow">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Money Flow</h2>
          {flowLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : (
            <FlowSankey nodes={flow?.nodes ?? []} links={flow?.links ?? []} />
          )}
        </div>
      </WidgetErrorBoundary>

      {/* Margin heatmap + revenue treemap (same matrix fetch) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WidgetErrorBoundary title="Margin Heatmap">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Margin Heatmap</h2>
            {matrixLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <MarginHeatmap matrix={matrix ?? { clients: [], partners: [], cells: [] }} />
            )}
          </div>
        </WidgetErrorBoundary>

        <WidgetErrorBoundary title="Revenue Treemap">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Revenue Treemap</h2>
            {matrixLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <RevenueTreemap cells={matrix?.cells ?? []} />
            )}
          </div>
        </WidgetErrorBoundary>
      </div>

      {/* Traffic quality (fraud) */}
      <WidgetErrorBoundary title="Traffic Quality">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Traffic Quality</h2>
          {fraudLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <FraudTrendChart points={fraud ?? []} />
          )}
        </div>
      </WidgetErrorBoundary>
    </div>
  );
}
