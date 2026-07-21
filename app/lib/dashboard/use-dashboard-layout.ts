"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SavedDashboard, DashboardLayoutItem } from "./types";
import { readLocalDashboard, resolveInitialDashboard, LOCAL_KEYS } from "./resolve-layout";

// TODO(Task 20): replace DEFAULT_DASHBOARD with resolvePreset("exec", has).
// activeWidgets + layout lifted from the pre-redesign page.tsx defaultLayout.
const DEFAULT_DASHBOARD: SavedDashboard = {
  activeWidgets: [
    "revenue-kpi",
    "cost-kpi",
    "profit-kpi",
    "margin-kpi",
    "counts-row",
    "profit-chart",
    "alerts-panel",
    "client-performance-chart",
    "platform-performance-chart",
    "transactions-table",
    "working-capital",
  ],
  layout: [
    { i: "revenue-kpi", x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
    { i: "cost-kpi", x: 3, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
    { i: "profit-kpi", x: 6, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
    { i: "margin-kpi", x: 9, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
    { i: "counts-row", x: 0, y: 3, w: 12, h: 3, minW: 6, minH: 2 },
    { i: "profit-chart", x: 0, y: 6, w: 8, h: 9, minW: 4, minH: 6 },
    { i: "alerts-panel", x: 8, y: 6, w: 4, h: 9, minW: 3, minH: 4 },
    { i: "client-performance-chart", x: 0, y: 15, w: 6, h: 8, minW: 4, minH: 5 },
    { i: "platform-performance-chart", x: 6, y: 15, w: 6, h: 8, minW: 4, minH: 5 },
    { i: "transactions-table", x: 0, y: 23, w: 12, h: 8, minW: 6, minH: 5 },
    { i: "working-capital", x: 0, y: 31, w: 4, h: 8, minW: 3, minH: 5 },
  ] as DashboardLayoutItem[],
  preset: null,
};

async function fetchSaved(): Promise<SavedDashboard | null> {
  const res = await fetch("/api/me/dashboard-layout");
  if (!res.ok) return null;
  const row = await res.json();
  return row ? { activeWidgets: row.activeWidgets, layout: row.layout, preset: row.preset } : null;
}

async function putSaved(body: SavedDashboard): Promise<void> {
  await fetch("/api/me/dashboard-layout", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function useDashboardLayout() {
  const { data: server, isLoading } = useQuery({ queryKey: ["dashboard-layout"], queryFn: fetchSaved, staleTime: Infinity });
  const [state, setState] = useState<SavedDashboard | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading || state) return;
    const local = typeof window !== "undefined" ? readLocalDashboard(window.localStorage) : null;
    const { value, migrateFromLocal } = resolveInitialDashboard(server ?? null, local, DEFAULT_DASHBOARD);
    setState(value);
    if (migrateFromLocal && typeof window !== "undefined") {
      void putSaved(value);
      window.localStorage.removeItem(LOCAL_KEYS.widgets);
      window.localStorage.removeItem(LOCAL_KEYS.layout);
    }
  }, [isLoading, server, state]);

  const persist = (next: SavedDashboard) => {
    setState(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void putSaved(next), 600);
  };

  return {
    ready: !!state,
    activeWidgets: state?.activeWidgets ?? [],
    layout: state?.layout ?? [],
    preset: state?.preset ?? null,
    setLayout: (layout: DashboardLayoutItem[]) => state && persist({ ...state, layout }),
    setActiveWidgets: (activeWidgets: string[]) => state && persist({ ...state, activeWidgets }),
    applyPreset: (p: SavedDashboard) => persist(p),
  };
}
