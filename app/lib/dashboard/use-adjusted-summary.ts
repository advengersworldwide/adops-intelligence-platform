"use client";

import { useGetDashboardSummary } from "@workspace/api-client-react";
import { useDashboardRange } from "@/lib/dashboard/range-context";

/**
 * The dashboard summary endpoint now sources from `billing_records` and
 * returns totalRevenue/totalCost/totalProfit/marginPct already computed in
 * PKR (via `computeRow`) — no client-side currency conversion needed.
 *
 * Kept as a thin wrapper (rather than inlining `useGetDashboardSummary`
 * everywhere) so the KPI + counts widgets keep consuming the same
 * `{ summary, adjustedSummary, isLoading, baseCurrency }` shape.
 */
export function useAdjustedSummary() {
  const range = useDashboardRange();
  const { data: summary, isLoading } = useGetDashboardSummary(range as never);

  return { summary, adjustedSummary: summary ?? null, isLoading, baseCurrency: "PKR" };
}