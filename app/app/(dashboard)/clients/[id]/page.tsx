"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Pencil, Check, X } from "lucide-react";
import {
  useGetClient, useUpdateClient, getGetClientQueryKey, useListClientPartners,
  useListClientEvents, useCreateClientEvent, useUpdateClientEvent, useDeleteClientEvent,
  getListClientEventsQueryKey,
  useListCostModels, useListPaymentTerms,
  type ClientEvent,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { GatedTabs } from "@/components/rbac/GatedTabs";
import { CLIENT_DETAIL_TABS } from "@/lib/rbac/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useHasPermission, useCan } from "@/lib/auth/user-context";
import { KycFields, kycFromRecord, kycToPayload, type KycState, EMPTY_KYC } from "@/components/KycFields";
import { cn } from "@/lib/utils";
import { PermissionGuard } from "@/components/PermissionGuard";

// ── Details Tab ──────────────────────────────────────────────────────────────

function DetailsTab({ clientId }: { clientId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("clients:edit");
  const can = useCan();
  const { data: client } = useGetClient(clientId);
  const { data: paymentTerms } = useListPaymentTerms();
  const { data: clientPartners } = useListClientPartners(clientId);
  const updateClient = useUpdateClient();

  const [kyc, setKyc] = useState<KycState>(EMPTY_KYC);
  const [bulkDiscountPct, setBulkDiscountPct] = useState("");
  const [paymentTermsId, setPaymentTermsId] = useState("none");
  const [codePrefix, setCodePrefix] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!client) return;
    setKyc(kycFromRecord(client));
    setBulkDiscountPct(client.bulkDiscountPct != null ? String(client.bulkDiscountPct) : "");
    setPaymentTermsId(client.paymentTermsId != null ? String(client.paymentTermsId) : "none");
    setCodePrefix(client.codePrefix ?? "");
  }, [client]);

  async function handleSave() {
    if (!client) return;
    if (!/^[A-Z0-9]{2,4}$/.test(codePrefix)) {
      toast({ title: "PO code prefix must be 2–4 uppercase letters/numbers", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await updateClient.mutateAsync({ id: clientId, data: {
        ...kycToPayload(kyc),
        codePrefix,
        bulkDiscountPct: bulkDiscountPct.trim() !== "" ? parseFloat(bulkDiscountPct) : null,
        paymentTermsId: paymentTermsId === "none" ? null : parseInt(paymentTermsId, 10),
      }});
      await qc.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
      toast({ title: "Changes saved" });
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <KycFields value={kyc} onChange={setKyc} disabled={!canEdit}
        showBank={can("clients.bank:view")} showTax={can("clients.tax:view")} />
      <div className="rounded-lg border border-border bg-card p-5 max-w-xs space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">PO Code Prefix</span>
        <Input value={codePrefix} disabled={!canEdit} maxLength={4}
          onChange={e => setCodePrefix(e.target.value.toUpperCase())}
          data-testid="client-edit-prefix-input" />
        <p className="text-xs text-muted-foreground">2–4 letters/numbers. e.g. EP-0126-0001</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Tax Rates & Payment</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Bulk Discount %</span>
            <Input type="number" step="0.01" min={0} value={bulkDiscountPct} disabled={!canEdit}
              onChange={e => setBulkDiscountPct(e.target.value)} placeholder="e.g. 5" />
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Payment Terms</span>
            <Select value={paymentTermsId} onValueChange={setPaymentTermsId} disabled={!canEdit}>
              <SelectTrigger><SelectValue placeholder="Select payment terms" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {(paymentTerms ?? []).map(pt => <SelectItem key={pt.id} value={String(pt.id)}>{pt.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      {canEdit && <div className="flex justify-end"><Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button></div>}

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <h3 className="text-sm font-semibold text-foreground">Partners used by this client</h3>
        </div>
        {!clientPartners?.length ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No partners linked yet. Link them from a partner&apos;s Clients tab.</p>
        ) : (
          <ul className="divide-y divide-border">
            {clientPartners.map(p => (
              <li key={p.id} className="px-5 py-3 text-sm">
                <Link href={`/partners/${p.id}`} className="font-medium text-foreground hover:text-primary hover:underline">{p.name}</Link>
                {p.codePrefix && <span className="ml-2 text-xs text-muted-foreground">({p.codePrefix})</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Events Tab ───────────────────────────────────────────────────────────────

function EventsTab({ clientId }: { clientId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("clients:edit");
  const invalidate = () => qc.invalidateQueries({ queryKey: getListClientEventsQueryKey(clientId) });

  const { data: events, isLoading } = useListClientEvents(clientId);
  const { data: costModels } = useListCostModels();
  const createEvent = useCreateClientEvent({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Event added" }); } } });
  const deleteEvent = useDeleteClientEvent({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Event deleted" }); } } });

  const [newName, setNewName] = useState("");
  const [newCostModelId, setNewCostModelId] = useState("none");
  const [newBillableRate, setNewBillableRate] = useState("");

  function handleAdd() {
    const name = newName.trim();
    const rate = parseFloat(newBillableRate);
    if (!name || isNaN(rate)) return;
    createEvent.mutate({
      id: clientId,
      data: {
        name,
        costModelId: newCostModelId === "none" ? null : parseInt(newCostModelId, 10),
        billableRate: rate,
      },
    });
    setNewName(""); setNewCostModelId("none"); setNewBillableRate("");
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Add Event</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Event Name</span>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Install, Purchase" />
            </label>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Cost Model</span>
              <Select value={newCostModelId} onValueChange={setNewCostModelId}>
                <SelectTrigger><SelectValue placeholder="Select cost model" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {(costModels ?? []).map(cm => <SelectItem key={cm.id} value={String(cm.id)}>{cm.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Billable Rate ($)</span>
              <Input type="number" step="0.0001" value={newBillableRate} onChange={e => setNewBillableRate(e.target.value)} placeholder="0.00" />
            </label>
          </div>
          <div className="flex justify-end">
            <Button size="sm" className="gap-1.5" onClick={handleAdd} disabled={!newName.trim() || !newBillableRate}>
              <Plus className="h-3.5 w-3.5" /> Add Event
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-5 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
        ) : !events?.length ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Cost Model</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Billable Rate ($)</th>
                {canEdit && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <EventRow key={ev.id} clientId={clientId} ev={ev} canEdit={!!canEdit}
                  costModels={costModels ?? []} onDelete={() => deleteEvent.mutate({ id: clientId, eventId: ev.id })}
                  onUpdated={invalidate} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EventRow({ clientId, ev, canEdit, costModels, onDelete, onUpdated }: {
  clientId: number;
  ev: ClientEvent;
  canEdit: boolean;
  costModels: Array<{ id: number; name: string }>;
  onDelete: () => void;
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const updateEvent = useUpdateClientEvent({ mutation: { onSuccess: () => { onUpdated(); toast({ title: "Event updated" }); } } });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ev.name);
  const [costModelId, setCostModelId] = useState(ev.costModelId != null ? String(ev.costModelId) : "none");
  const [billableRate, setBillableRate] = useState(String(ev.billableRate));

  function handleSave() {
    const rate = parseFloat(billableRate);
    if (!name.trim() || isNaN(rate)) return;
    updateEvent.mutate({ id: clientId, eventId: ev.id, data: {
      name: name.trim(),
      costModelId: costModelId === "none" ? null : parseInt(costModelId, 10),
      billableRate: rate,
    }});
    setEditing(false);
  }

  if (!editing) {
    return (
      <tr className="border-b border-border last:border-0 hover:bg-muted/30">
        <td className="px-4 py-2.5 text-sm font-medium">{ev.name}</td>
        <td className="px-4 py-2.5 text-sm text-muted-foreground">{ev.costModelName ?? "—"}</td>
        <td className="px-4 py-2.5 text-sm">{ev.billableRate}</td>
        {canEdit && (
          <td className="px-4 py-2.5">
            <div className="flex gap-1 justify-end">
              <button onClick={() => setEditing(true)} className="rounded p-1.5 text-muted-foreground hover:bg-accent">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={onDelete} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </td>
        )}
      </tr>
    );
  }

  return (
    <tr className="border-b border-border last:border-0 bg-muted/20">
      <td className="px-4 py-2"><Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" /></td>
      <td className="px-4 py-2">
        <Select value={costModelId} onValueChange={setCostModelId}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {costModels.map(cm => <SelectItem key={cm.id} value={String(cm.id)}>{cm.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </td>
      <td className="px-4 py-2"><Input type="number" step="0.0001" value={billableRate} onChange={e => setBillableRate(e.target.value)} className="h-8 w-28 text-sm" /></td>
      <td className="px-4 py-2">
        <div className="flex gap-1 justify-end">
          <button onClick={handleSave} className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"><Check className="h-3.5 w-3.5" /></button>
          <button onClick={() => setEditing(false)} className="rounded p-1.5 text-muted-foreground hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
        </div>
      </td>
    </tr>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function ClientDetailPage({ id }: { id: number }) {
  const { data: client, isLoading } = useGetClient(id);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
    );
  }

  if (!client) return <div className="text-sm text-muted-foreground">Client not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/clients">
          <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <ArrowLeft className="h-4 w-4" />
          </button>
        </Link>
        <h1 className="text-xl font-bold text-foreground">{client.name}</h1>
        {client.buyingHouseName && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {client.buyingHouseName}
          </span>
        )}
      </div>

      <GatedTabs
        nodes={CLIENT_DETAIL_TABS}
        content={{
          details: <DetailsTab clientId={id} />,
          events: <EventsTab clientId={id} />,
        }}
      />
    </div>
  );
}

export default function ClientDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return (
    <PermissionGuard permission="clients:view">
      <ClientDetailPage id={parseInt(id, 10)} />
    </PermissionGuard>
  );
}
