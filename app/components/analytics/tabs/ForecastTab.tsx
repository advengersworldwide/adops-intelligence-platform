"use client";

import {
  useGetForecast,
  useGetAnomalies,
  useGetAiInsights,
} from "@workspace/api-client-react";
import { useAnalyticsFilters } from "@/hooks/use-analytics-filters";
import { buildAnalyticsParams } from "@/lib/analytics/filters";
import { WidgetErrorBoundary } from "@/components/analytics/WidgetErrorBoundary";
import { ForecastChart } from "@/components/analytics/charts/ForecastChart";
import { AnomalyChart } from "@/components/analytics/charts/AnomalyChart";
import { WhatIfSimulator } from "@/components/analytics/WhatIfSimulator";
import { AiInsightStrip } from "@/components/analytics/AiInsightStrip";
import { Skeleton } from "@/components/ui/skeleton";

export function ForecastTab() {
  const { filters } = useAnalyticsFilters();
  const params = buildAnalyticsParams(filters);

  const { data: forecast, isLoading: forecastLoading } = useGetForecast(params as never);
  const { data: anomalies, isLoading: anomaliesLoading } = useGetAnomalies(params as never);
  const { data: insights, isLoading: insightsLoading } = useGetAiInsights();

  return (
    <div className="space-y-6">
      {/* AI "what changed" strip */}
      <WidgetErrorBoundary title="AI Insights">
        <AiInsightStrip insights={insights ?? []} loading={insightsLoading} />
      </WidgetErrorBoundary>

      {/* Forecast */}
      <WidgetErrorBoundary title="Forecast">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Forecast</h2>
          {forecastLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : (
            <ForecastChart history={forecast?.history ?? []} forecast={forecast?.forecast ?? []} />
          )}
        </div>
      </WidgetErrorBoundary>

      {/* Anomalies */}
      <WidgetErrorBoundary title="Anomalies">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Anomalies</h2>
          {anomaliesLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : (
            <AnomalyChart points={anomalies ?? []} />
          )}
        </div>
      </WidgetErrorBoundary>

      {/* What-if simulator */}
      <WidgetErrorBoundary title="What-If Simulator">
        <WhatIfSimulator />
      </WidgetErrorBoundary>
    </div>
  );
}
