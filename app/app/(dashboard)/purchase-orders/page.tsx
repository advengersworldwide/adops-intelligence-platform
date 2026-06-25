"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PermissionGuard } from "@/components/PermissionGuard";
import { ClientPOTab } from "@/components/purchase-orders/ClientPOTab";
import { PartnerPOTab } from "@/components/purchase-orders/PartnerPOTab";

function PurchaseOrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Purchase Orders</h1>
        <p className="text-sm text-muted-foreground">Client requests and partner orders</p>
      </div>
      <Tabs defaultValue="clients">
        <TabsList>
          <TabsTrigger value="clients" data-testid="po-tab-clients">Clients</TabsTrigger>
          <TabsTrigger value="partners" data-testid="po-tab-partners">Partners</TabsTrigger>
        </TabsList>
        <TabsContent value="clients" className="mt-4"><ClientPOTab /></TabsContent>
        <TabsContent value="partners" className="mt-4"><PartnerPOTab /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function PurchaseOrdersRoute() {
  return (
    <PermissionGuard permission="View Purchase Orders">
      <PurchaseOrdersPage />
    </PermissionGuard>
  );
}
