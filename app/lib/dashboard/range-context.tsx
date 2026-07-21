"use client";
import { createContext, useContext } from "react";

export type DashRange = { dateFrom: string; dateTo: string };
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function computePreset(key: string, now = new Date()): DashRange {
  const to = iso(now);
  if (key === "last30") return { dateFrom: iso(new Date(now.getTime() - 29 * 86400000)), dateTo: to };
  if (key === "ytd") return { dateFrom: iso(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), dateTo: to };
  if (key === "qtd") { const q = Math.floor(now.getUTCMonth() / 3) * 3; return { dateFrom: iso(new Date(Date.UTC(now.getUTCFullYear(), q, 1))), dateTo: to }; }
  return { dateFrom: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), dateTo: to }; // mtd
}

export const DashboardRangeContext = createContext<DashRange>(computePreset("mtd"));
export function useDashboardRange(): DashRange { return useContext(DashboardRangeContext); }
