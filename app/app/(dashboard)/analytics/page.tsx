"use client";

import { AnalyticsFilterProvider } from "@/hooks/use-analytics-filters";
import { FilterBar } from "@/components/analytics/FilterBar";
import { PermissionGuard } from "@/components/PermissionGuard";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProfitabilityTab } from "@/components/analytics/tabs/ProfitabilityTab";
import { FinancialOpsTab } from "@/components/analytics/tabs/FinancialOpsTab";
import { RelationshipsTab } from "@/components/analytics/tabs/RelationshipsTab";
import { ForecastTab } from "@/components/analytics/tabs/ForecastTab";

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
              <FinancialOpsTab />
            </TabsContent>
            <TabsContent value="relationships">
              <RelationshipsTab />
            </TabsContent>
            <TabsContent value="forecast">
              <ForecastTab />
            </TabsContent>
          </Tabs>
        </div>
      </AnalyticsFilterProvider>
    </PermissionGuard>
  );
}
