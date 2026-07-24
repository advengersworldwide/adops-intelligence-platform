"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import {
  useGetBuyingHouse, useUpdateBuyingHouse, getGetBuyingHouseQueryKey,
  useGetBuyingHouseAnalytics,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useHasPermission } from "@/lib/auth/user-context";
import { KycFields, kycFromRecord, kycToPayload, type KycState, EMPTY_KYC } from "@/components/KycFields";
import { PermissionGuard } from "@/components/PermissionGuard";

function BuyingHouseDetailPage({ id }: { id: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("buying-houses:edit");

  const { data: bh, isLoading: bhLoading } = useGetBuyingHouse(id);
  const { data: analytics, isLoading: analyticsLoading } = useGetBuyingHouseAnalytics(id);
  const updateBH = useUpdateBuyingHouse();

  const [kyc, setKyc] = useState<KycState>(EMPTY_KYC);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!bh) return;
    setKyc(kycFromRecord(bh));
  }, [bh]);

  async function handleSave() {
    if (!bh) return;
    setSaving(true);
    try {
      await updateBH.mutateAsync({ id, data: {
        name: bh.name,
        ...kycToPayload(kyc),
      }});
      await qc.invalidateQueries({ queryKey: getGetBuyingHouseQueryKey(id) });
      toast({ title: "Changes saved" });
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  if (bhLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  if (!bh) return <div className="text-sm text-muted-foreground">Buying house not found.</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/buying-houses">
          <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <ArrowLeft className="h-4 w-4" />
          </button>
        </Link>
        <Building2 className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-bold text-foreground">{bh.name}</h1>
      </div>

      {/* Details — KYC */}
      <KycFields value={kyc} onChange={setKyc} disabled={!canEdit} />
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </div>
      )}

      {/* Clients under this buying house */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <h2 className="text-sm font-semibold text-foreground">Clients under this buying house</h2>
        </div>
        {analyticsLoading ? (
          <div className="p-5 space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : !analytics?.clients.length ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No clients assigned yet</p>
        ) : (
          <ul className="divide-y divide-border">
            {analytics.clients.map(c => (
              <li key={c.id} className="px-5 py-3 text-sm font-medium text-foreground">
                <Link href={`/clients/${c.id}`} className="hover:text-primary hover:underline">{c.name}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function BuyingHouseDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return (
    <PermissionGuard permission="buying-houses:view">
      <BuyingHouseDetailPage id={parseInt(id, 10)} />
    </PermissionGuard>
  );
}
