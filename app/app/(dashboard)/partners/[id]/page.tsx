"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useGetPartner } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { GatedTabs } from "@/components/rbac/GatedTabs";
import { PARTNER_DETAIL_TABS } from "@/lib/rbac/tabs";
import { PermissionGuard } from "@/components/PermissionGuard";
import PartnerDetailsTab from "./DetailsTab";
import PartnerClientsTab from "./ClientsTab";

function PartnerDetailPage({ id }: { id: number }) {
  const { data: partner, isLoading } = useGetPartner(id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/partners" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        {isLoading ? (
          <Skeleton className="h-7 w-48" />
        ) : (
          <h1 className="text-xl font-bold text-foreground">{partner?.name}</h1>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : partner ? (
        <GatedTabs
          nodes={PARTNER_DETAIL_TABS}
          content={{
            details: <PartnerDetailsTab partner={partner} />,
            clients: <PartnerClientsTab partnerId={id} />,
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Partner not found.</p>
      )}
    </div>
  );
}

export default function PartnerDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return (
    <PermissionGuard permission="partners:view">
      <PartnerDetailPage id={parseInt(id, 10)} />
    </PermissionGuard>
  );
}
