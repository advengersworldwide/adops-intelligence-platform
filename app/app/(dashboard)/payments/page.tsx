"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PermissionGuard } from "@/components/PermissionGuard";
import { ClientPaymentsTab } from "@/components/payments/ClientPaymentsTab";
import { PartnerPaymentsTab } from "@/components/payments/PartnerPaymentsTab";

export default function PaymentsPage() {
  return (
    <PermissionGuard permission="payments:view">
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-foreground">Payments</h1>
        <Tabs defaultValue="client">
          <TabsList>
            <TabsTrigger value="client">Client</TabsTrigger>
            <TabsTrigger value="partner">Partner</TabsTrigger>
          </TabsList>
          <TabsContent value="client"><ClientPaymentsTab /></TabsContent>
          <TabsContent value="partner"><PartnerPaymentsTab /></TabsContent>
        </Tabs>
      </div>
    </PermissionGuard>
  );
}
