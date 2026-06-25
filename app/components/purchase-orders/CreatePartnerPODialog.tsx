"use client";

import { useState, useEffect, useMemo } from "react";
import {
  useListPartners, useListPartnerClients, useListClientPurchaseOrdersByClient,
  useCreatePartnerPurchaseOrder, getListPartnerPurchaseOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { lineBudget, totalBudget } from "@/lib/po-totals";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface DraftItem { clientEventId: number; eventName: string; cacRate: number; eventCount: number; selected: boolean; }

export function CreatePartnerPODialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: partners } = useListPartners();

  const [partnerId, setPartnerId] = useState<string>("");
  const [clientId, setClientId] = useState<string>("");
  const [cpoId, setCpoId] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);

  // Cascade sources — passing 0 naturally disables via the generated enabled: !!(id) default
  const { data: partnerClients } = useListPartnerClients(partnerId ? Number(partnerId) : 0);
  const { data: cpos } = useListClientPurchaseOrdersByClient(clientId ? Number(clientId) : 0);

  const selectedClient = useMemo(
    () => partnerClients?.find(pc => pc.clientId === Number(clientId)),
    [partnerClients, clientId],
  );

  useEffect(() => { if (open) { setPartnerId(""); setClientId(""); setCpoId(""); setStartDate(""); setEndDate(""); setItems([]); } }, [open]);
  useEffect(() => { setClientId(""); setCpoId(""); setItems([]); }, [partnerId]);
  useEffect(() => { setCpoId(""); }, [clientId]);

  useEffect(() => {
    if (!selectedClient) { setItems([]); return; }
    const payable = (selectedClient.events ?? []).filter(e => e.payoutRate != null);
    setItems(payable.map(e => ({
      clientEventId: e.clientEventId, eventName: e.name, cacRate: Number(e.payoutRate), eventCount: 0, selected: false,
    })));
  }, [selectedClient]);

  const create = useCreatePartnerPurchaseOrder();
  const chosen = items.filter(i => i.selected && i.eventCount > 0);
  const total = totalBudget(chosen.map(i => ({ cacRate: i.cacRate, eventCount: i.eventCount })));

  function setItem(id: number, patch: Partial<DraftItem>) {
    setItems(prev => prev.map(i => i.clientEventId === id ? { ...i, ...patch } : i));
  }

  async function onSubmit() {
    if (!partnerId || !clientId || !cpoId || !startDate || !endDate) {
      toast({ title: "Fill partner, client, CPO and duration", variant: "destructive" }); return;
    }
    if (chosen.length === 0) { toast({ title: "Select at least one event with a count", variant: "destructive" }); return; }
    try {
      await create.mutateAsync({ data: {
        partnerId: Number(partnerId), clientPurchaseOrderId: Number(cpoId), startDate, endDate,
        items: chosen.map(i => ({ clientEventId: i.clientEventId, eventName: i.eventName, cacRate: i.cacRate, eventCount: i.eventCount })),
      }});
      qc.invalidateQueries({ queryKey: getListPartnerPurchaseOrdersQueryKey() });
      toast({ title: "Partner purchase order created" });
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Create failed", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Partner Purchase Order</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Partner <span className="text-destructive">*</span></Label>
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger data-testid="ppo-partner-select"><SelectValue placeholder="Select partner" /></SelectTrigger>
                <SelectContent>{partners?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Client <span className="text-destructive">*</span></Label>
              <Select value={clientId} onValueChange={setClientId} disabled={!partnerId}>
                <SelectTrigger data-testid="ppo-client-select"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{partnerClients?.map(pc => <SelectItem key={pc.clientId} value={String(pc.clientId)}>{pc.clientName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Client PO <span className="text-destructive">*</span></Label>
              <Select value={cpoId} onValueChange={setCpoId} disabled={!clientId}>
                <SelectTrigger data-testid="ppo-cpo-select"><SelectValue placeholder="Select CPO" /></SelectTrigger>
                <SelectContent>
                  {cpos?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.code} ({new Date(c.createdAt).toLocaleDateString()})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>From <span className="text-destructive">*</span></Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="ppo-start" />
            </div>
            <div className="space-y-1.5">
              <Label>To <span className="text-destructive">*</span></Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} data-testid="ppo-end" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Events</Label>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">{clientId ? "This partner has no payout rates configured for this client&apos;s events." : "Select a partner and client to load events."}</p>
            ) : (
              <div className="rounded-lg border border-border divide-y">
                <div className="grid grid-cols-[auto_1fr_5rem_6rem_6rem] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span></span><span>Event</span><span>CAC</span><span>Count</span><span className="text-right">Budget</span>
                </div>
                {items.map(it => (
                  <div key={it.clientEventId} className="grid grid-cols-[auto_1fr_5rem_6rem_6rem] items-center gap-2 px-3 py-2">
                    <Checkbox checked={it.selected} onCheckedChange={v => setItem(it.clientEventId, { selected: !!v })} data-testid={`ppo-event-${it.clientEventId}`} />
                    <span className="text-sm">{it.eventName}</span>
                    <span className="text-sm text-muted-foreground">{it.cacRate}</span>
                    <Input type="number" min={0} value={it.eventCount || ""} disabled={!it.selected}
                      onChange={e => setItem(it.clientEventId, { eventCount: Number(e.target.value) })}
                      className="h-8 text-sm" data-testid={`ppo-count-${it.clientEventId}`} />
                    <span className="text-sm text-right">{it.selected && it.eventCount > 0 ? money(lineBudget(it.cacRate, it.eventCount)) : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-medium">Total Budget</span>
            <span className="text-lg font-bold" data-testid="ppo-total">{money(total)}</span>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={onSubmit} disabled={create.isPending} data-testid="submit-ppo-btn">
              {create.isPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
