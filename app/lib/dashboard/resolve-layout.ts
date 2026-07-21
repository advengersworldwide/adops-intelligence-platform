import type { SavedDashboard } from "./types";

export const LOCAL_KEYS = {
  widgets: "adops-dashboard-active-widgets",
  layout: "adops-dashboard-layout",
} as const;

export function readLocalDashboard(storage: Storage): SavedDashboard | null {
  const widgets = storage.getItem(LOCAL_KEYS.widgets);
  const layout = storage.getItem(LOCAL_KEYS.layout);
  if (!widgets && !layout) return null;
  try {
    return {
      activeWidgets: widgets ? JSON.parse(widgets) : [],
      layout: layout ? JSON.parse(layout) : [],
      preset: null,
    };
  } catch {
    return null;
  }
}

export function resolveInitialDashboard(
  server: SavedDashboard | null,
  local: SavedDashboard | null,
  fallback: SavedDashboard,
): { value: SavedDashboard; migrateFromLocal: boolean } {
  if (server) return { value: server, migrateFromLocal: false };
  if (local) return { value: local, migrateFromLocal: true };
  return { value: fallback, migrateFromLocal: false };
}