"use client";

import { PermissionGuard } from "@/components/PermissionGuard";
import { GatedTabs } from "@/components/rbac/GatedTabs";
import { BILLING_TABS } from "@/lib/rbac/tabs";
import { ClientBillingSummaryTab } from "@/components/billings/ClientBillingSummaryTab";
import { ClientBillingDetailTab } from "@/components/billings/ClientBillingDetailTab";
import { PartnerBillingTab } from "@/components/billings/PartnerBillingTab";

export default function BillingPage() {
  return (
    <PermissionGuard permission="billings:view">
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Billing</h1>
        <GatedTabs
          nodes={BILLING_TABS}
          content={{
            summary: <ClientBillingSummaryTab />,
            detail: <ClientBillingDetailTab />,
            partner: <PartnerBillingTab />,
          }}
        />
      </div>
    </PermissionGuard>
  );
}
