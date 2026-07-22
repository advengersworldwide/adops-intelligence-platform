"use client";

import { useGetDashboardSummary } from "@workspace/api-client-react";
import { useDashboardRange } from "@/lib/dashboard/range-context";
import { useBaseCurrency } from "@/lib/dashboard/use-base-currency";

/**
 * The dashboard summary endpoint sources from `billing_records` and returns
 * totalRevenue/totalCost/totalProfit/marginPct already computed in PKR (via
 * `computeRow`). We surface the configured base currency for display; when it is
 * PKR (the default) no conversion is needed.
 */
export function useAdjustedSummary() {
  const range = useDashboardRange();
  const baseCurrency = useBaseCurrency();
  const { data: summary, isLoading } = useGetDashboardSummary(range as never);

  return { summary, adjustedSummary: summary ?? null, isLoading, baseCurrency };
}
