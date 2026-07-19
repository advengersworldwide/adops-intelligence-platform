"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { AnalyticsFilters, RevenueEngine, FinancialStatus } from "@/lib/analytics/filters";

function defaultRange(): { dateFrom: string; dateTo: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { dateFrom: iso(from), dateTo: iso(to) };
}

const defaultFilters: AnalyticsFilters = {
  ...defaultRange(),
  engine: "combined", clientIds: [], partnerIds: [], buyingHouseIds: [],
  costModelId: null, poId: null, status: null, compare: false,
};

interface Ctx {
  filters: AnalyticsFilters;
  setFilters: (patch: Partial<AnalyticsFilters>) => void;
  reset: () => void;
}
const AnalyticsFilterContext = createContext<Ctx | null>(null);

export function AnalyticsFilterProvider({ children }: { children: ReactNode }) {
  const [filters, setState] = useState<AnalyticsFilters>(defaultFilters);
  const value = useMemo<Ctx>(() => ({
    filters,
    setFilters: (patch) => setState((f) => ({ ...f, ...patch })),
    reset: () => setState(defaultFilters),
  }), [filters]);
  return <AnalyticsFilterContext.Provider value={value}>{children}</AnalyticsFilterContext.Provider>;
}

export function useAnalyticsFilters(): Ctx {
  const ctx = useContext(AnalyticsFilterContext);
  if (!ctx) throw new Error("useAnalyticsFilters must be used within AnalyticsFilterProvider");
  return ctx;
}

export type { AnalyticsFilters, RevenueEngine, FinancialStatus };
