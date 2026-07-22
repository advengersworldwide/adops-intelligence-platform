"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PermissionGuard } from "@/components/PermissionGuard";
import { useHasPermission } from "@/lib/auth/user-context";
import { ClientBillingSummaryTab } from "@/components/billings/ClientBillingSummaryTab";
import { ClientBillingDetailTab } from "@/components/billings/ClientBillingDetailTab";
import { PartnerBillingTab } from "@/components/billings/PartnerBillingTab";

export default function BillingPage() {
  const canDetail = useHasPermission("billings.client.detail:view");
  return (
    <PermissionGuard permission="billings:view">
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Billing</h1>
        <Tabs defaultValue="client">
          <TabsList>
            <TabsTrigger value="client">Client</TabsTrigger>
            <TabsTrigger value="partner">Partner</TabsTrigger>
          </TabsList>
          <TabsContent value="client">
            <Tabs defaultValue="summary">
              <TabsList>
                <TabsTrigger value="summary">Summary</TabsTrigger>
                {canDetail && <TabsTrigger value="detail">Detail</TabsTrigger>}
              </TabsList>
              <TabsContent value="summary"><ClientBillingSummaryTab /></TabsContent>
              {canDetail && <TabsContent value="detail"><ClientBillingDetailTab /></TabsContent>}
            </Tabs>
          </TabsContent>
          <TabsContent value="partner"><PartnerBillingTab /></TabsContent>
        </Tabs>
      </div>
    </PermissionGuard>
  );
}
