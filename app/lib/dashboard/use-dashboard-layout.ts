"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SavedDashboard, DashboardLayoutItem } from "./types";
import { readLocalDashboard, resolveInitialDashboard, LOCAL_KEYS } from "./resolve-layout";
import { EXEC_PRESET } from "./presets";

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
    const { value, migrateFromLocal } = resolveInitialDashboard(server ?? null, local, EXEC_PRESET);
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
