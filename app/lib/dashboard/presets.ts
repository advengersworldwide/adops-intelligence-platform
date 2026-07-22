import type { SavedDashboard, DashboardLayoutItem } from "./types";
import { widgetRegistry } from "@/components/dashboard/widget-registry";

export const PRESETS: Record<"exec" | "ops" | "finance", { activeWidgets: string[] }> = {
  exec: { activeWidgets: ["revenue-kpi", "profit-kpi", "margin-kpi", "cash-position-kpi", "ai-insights", "forecast-trend", "concentration", "working-capital", "alerts-panel"] },
  ops: { activeWidgets: ["revenue-kpi", "profit-kpi", "margin-kpi", "po-pacing", "platform-performance-chart", "anomalies", "transactions-table", "alerts-panel"] },
  finance: { activeWidgets: ["cash-position-kpi", "working-capital", "cashflow", "aging", "invoice-funnel", "transactions-table"] },
};

const COLS = 12;

// Pack widgets left-to-right, wrapping at 12 columns, with REAL finite integer positions
// (never Infinity — the layout is JSON-serialized to the DB and validated as z.number()).
function packLayout(ids: string[]): DashboardLayoutItem[] {
  let x = 0, y = 0, rowMaxH = 0;
  const out: DashboardLayoutItem[] = [];
  for (const id of ids) {
    const d = widgetRegistry[id].defaultLayout;
    if (x + d.w > COLS) { x = 0; y += rowMaxH; rowMaxH = 0; }
    out.push({ i: id, x, y, w: d.w, h: d.h, minW: d.minW, minH: d.minH });
    x += d.w; rowMaxH = Math.max(rowMaxH, d.h);
  }
  return out;
}

export function resolvePreset(key: keyof typeof PRESETS, has: (permission: string) => boolean): SavedDashboard {
  const activeWidgets = PRESETS[key].activeWidgets.filter((id) => {
    const def = widgetRegistry[id];
    return def && (def.permission === null || has(def.permission));
  });
  return { activeWidgets, layout: packLayout(activeWidgets), preset: key };
}

// Unfiltered Exec preset used as the first-load default; render-time role-gating hides
// any widgets the user lacks permission for.
export const EXEC_PRESET: SavedDashboard = resolvePreset("exec", () => true);
