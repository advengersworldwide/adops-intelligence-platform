"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ResponsiveGridLayout, useContainerWidth, type ResponsiveGridLayoutProps } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { PermissionGuard } from "@/components/PermissionGuard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { usePermissionSet } from "@/lib/auth/user-context";
import { useDashboardLayout } from "@/lib/dashboard/use-dashboard-layout";
import { visibleWidgetIds } from "@/lib/dashboard/role-gating";
import { widgetRegistry, widgetList } from "@/components/dashboard/widget-registry";
import type { DashboardLayoutItem } from "@/lib/dashboard/types";

const RGL = ResponsiveGridLayout as React.ComponentType<ResponsiveGridLayoutProps & { draggableHandle?: string }>;

function DashboardContent() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { width, containerRef } = useContainerWidth();
  const perms = usePermissionSet();
  const dash = useDashboardLayout();

  if (!dash.ready) return <div className="flex min-h-[60vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" /></div>;

  const visible = visibleWidgetIds(dash.activeWidgets, widgetRegistry, perms.has);

  const toggleWidget = (id: string) => {
    const next = dash.activeWidgets.includes(id)
      ? dash.activeWidgets.filter((w) => w !== id)
      : [...dash.activeWidgets, id];
    dash.setActiveWidgets(next);
  };

  const layoutFor = (ids: string[]): DashboardLayoutItem[] =>
    ids.map((id) => {
      const saved = dash.layout.find((l) => l.i === id);
      if (saved) return saved;
      const d = widgetRegistry[id].defaultLayout;
      return { i: id, x: 0, y: Infinity, w: d.w, h: d.h, minW: d.minW, minH: d.minH };
    });

  return (
    <div className="space-y-6 pb-12" ref={containerRef}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">AdOps Intelligence Overview</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)} className="gap-1.5 text-xs" data-testid="add-widget-btn">
          <Plus className="h-3.5 w-3.5" /> Add Widget
        </Button>
      </div>

      <RGL
        className="layout"
        width={width}
        layouts={{ lg: layoutFor(visible) }}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={30}
        onLayoutChange={(l: DashboardLayoutItem[]) => dash.setLayout(l)}
        draggableHandle=".widget-drag-handle"
        margin={[16, 16]}
      >
        {visible.map((id) => {
          const W = widgetRegistry[id].Component;
          return <div key={id}><W /></div>;
        })}
      </RGL>

      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Widget</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto py-2">
            {widgetList.filter((w) => w.permission === null || perms.has(w.permission)).map((w) => (
              <div key={w.id} onClick={() => toggleWidget(w.id)} data-testid={`widget-option-${w.id}`}
                className={cn("flex cursor-pointer items-center justify-between rounded-xl border p-3.5 transition-all",
                  dash.activeWidgets.includes(w.id) ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/50")}>
                <div>
                  <p className="text-sm font-medium text-foreground">{w.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{w.description}</p>
                </div>
                {dash.activeWidgets.includes(w.id) && <div className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">Active</div>}
              </div>
            ))}
          </div>
          <div className="flex justify-end pt-2"><Button variant="outline" onClick={() => setPaletteOpen(false)}>Close</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <PermissionGuard permission="View Dashboard">
      <DashboardContent />
    </PermissionGuard>
  );
}
