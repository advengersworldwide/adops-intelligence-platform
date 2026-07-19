"use client";

import { AnalyticsFilterProvider } from "@/hooks/use-analytics-filters";
import { FilterBar } from "@/components/analytics/FilterBar";
import { PermissionGuard } from "@/components/PermissionGuard";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProfitabilityTab } from "@/components/analytics/tabs/ProfitabilityTab";

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-10 text-center shadow-sm">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span> — coming in this rollout
      </p>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <PermissionGuard permission="View Analytics">
      <AnalyticsFilterProvider>
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-foreground">Analytics</h1>
              <p className="text-sm text-muted-foreground">Deep-dive into performance metrics</p>
            </div>
          </div>

          <FilterBar />

          <Tabs defaultValue="profitability">
            <TabsList>
              <TabsTrigger value="profitability">Profitability</TabsTrigger>
              <TabsTrigger value="financial">Financial Ops</TabsTrigger>
              <TabsTrigger value="relationships">Relationships</TabsTrigger>
              <TabsTrigger value="forecast">Forecast</TabsTrigger>
            </TabsList>

            <TabsContent value="profitability">
              <ProfitabilityTab />
            </TabsContent>
            <TabsContent value="financial">
              <ComingSoon label="Financial Operations" />
            </TabsContent>
            <TabsContent value="relationships">
              <ComingSoon label="Relationships & Concentration" />
            </TabsContent>
            <TabsContent value="forecast">
              <ComingSoon label="Forecast & Anomalies" />
            </TabsContent>
          </Tabs>
        </div>
      </AnalyticsFilterProvider>
    </PermissionGuard>
  );
}
