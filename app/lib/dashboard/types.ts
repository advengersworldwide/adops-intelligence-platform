import type * as React from "react";
import type { DashboardLayoutItem } from "@workspace/db";
import type { Permission } from "@/lib/rbac/catalog";

export type { DashboardLayoutItem };

export type WidgetCategory =
  | "kpi"
  | "profitability"
  | "financial-ops"
  | "relationships"
  | "risk"
  | "activity";

export interface WidgetDef {
  id: string;
  label: string;
  description: string;
  category: WidgetCategory;
  permission: Permission | null; // null => only page-level dashboard:view
  defaultLayout: { w: number; h: number; minW: number; minH: number };
  Component: React.ComponentType;
}

export interface SavedDashboard {
  activeWidgets: string[];
  layout: DashboardLayoutItem[];
  preset: string | null;
}