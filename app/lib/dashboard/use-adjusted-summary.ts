"use client";

import { useGetDashboardSummary, useGetAnalyticsByPartner } from "@workspace/api-client-react";
import { convertTo, DEFAULT_RATES } from "@/lib/analytics/currency";
import { useDashboardRange } from "@/lib/dashboard/range-context";

/**
 * Shared currency-adjustment logic lifted verbatim from the dashboard page's
 * `DashboardContent` component. Converts revenue/cost (and derived profit/margin)
 * from each platform's native currency into the user's configured base currency,
 * falling back to the raw summary totals when per-platform data isn't available.
 *
 * Consumed by the KPI + counts widgets so the numbers stay identical to what the
 * page previously computed inline.
 */
export function useAdjustedSummary() {
  const range = useDashboardRange();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary(range as never);
  const { data: byPlatform } = useGetAnalyticsByPartner(range as never);

  const baseCurrency = typeof window !== "undefined" ? (localStorage.getItem("adops-base-currency") || "USD") : "USD";
  const rawRates = typeof window !== "undefined" ? localStorage.getItem("adops-exchange-rates") : null;
  const exchangeRates = rawRates ? JSON.parse(rawRates) : DEFAULT_RATES;

  let convertedRevenue = 0;
  let convertedCost = 0;

  if (byPlatform && byPlatform.length > 0) {
    byPlatform.forEach(p => {
      convertedRevenue += convertTo(p.revenue, "USD", exchangeRates);
      convertedCost += convertTo(p.cost, "USD", exchangeRates);
    });
  } else {
    convertedRevenue = summary?.totalRevenue ?? 0;
    convertedCost = summary?.totalCost ?? 0;
  }

  const adjustedProfit = convertedRevenue - convertedCost;
  const adjustedMarginPct = convertedRevenue > 0 ? (adjustedProfit / convertedRevenue) * 100 : 0;

  const adjustedSummary = summary ? {
    ...summary,
    totalRevenue: convertedRevenue,
    totalCost: convertedCost,
    totalProfit: adjustedProfit,
    marginPct: adjustedMarginPct
  } : null;

  return { summary, adjustedSummary, isLoading: summaryLoading, baseCurrency };
}