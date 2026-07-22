"use client";

import { PermissionGuard } from "@/components/PermissionGuard";
import { GatedTabs } from "@/components/rbac/GatedTabs";
import { PURCHASE_ORDER_TABS } from "@/lib/rbac/tabs";
import { ClientPOTab } from "@/components/purchase-orders/ClientPOTab";
import { PartnerPOTab } from "@/components/purchase-orders/PartnerPOTab";

function PurchaseOrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Purchase Orders</h1>
        <p className="text-sm text-muted-foreground">Client requests and partner orders</p>
      </div>
      <GatedTabs
        nodes={PURCHASE_ORDER_TABS}
        content={{
          clients: <ClientPOTab />,
          partners: <PartnerPOTab />,
        }}
      />
    </div>
  );
}

export default function PurchaseOrdersRoute() {
  return (
    <PermissionGuard permission="purchase-orders:view">
      <PurchaseOrdersPage />
    </PermissionGuard>
  );
}
