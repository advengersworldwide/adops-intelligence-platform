"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  useListClients, useListPartners, useCreateBilling, useUpdateBilling,
} from "@workspace/api-client-react";
import type { BillingDetail } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { computeBilling } from "@/lib/compute-billing";

type PayableEvent = { clientEventId: number; name: string; billableRate: number; payoutRate: number };
type Cpo = { id: number; code: string };
type Ppo = { id: number; code: string; partnerId: number; partnerName?: string; items?: { eventName: string; eventCount: number; cacRate: number }[] };
type LineItem = { clientEventId: number; eventName: string; billableRate: number; payoutRate: number; eventCount: number };
type Line = { partnerId: number | null; partnerPurchaseOrderId: number | null; items: LineItem[] };

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export function CreateBillingDialog({ open, editBilling, onClose, onSuccess }: {
  open: boolean; editBilling?: BillingDetail; onClose: () => void; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { data: clients } = useListClients();
  const { data: partners } = useListPartners();

  const [clientId, setClientId] = useState<number | null>(null);
  const [period, setPeriod] = useState("");            // YYYY-MM
  const [cpoId, setCpoId] = useState<number | null>(null);
  const [cpos, setCpos] = useState<Cpo[]>([]);
  const [ppos, setPpos] = useState<Ppo[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [forexSellingRate, setForexSell] = useState(0);
  const [forexBuyingRate, setForexBuy] = useState(0);
  const [bulkDiscountPct, setBd] = useState(0);
  const [whtApplied, setWht] = useState(false);
  const [notes, setNotes] = useState("");
  const [tax, setTax] = useState({ remittanceTaxPct: 0, salesTaxPct: 0, withholdingTaxPct: 0 });

  useEffect(() => { if (open) fetch("/api/tax-settings").then(r => r.json()).then(setTax).catch(() => {}); }, [open]);

  useEffect(() => {
    if (open && editBilling) {
      setClientId(editBilling.clientId); setPeriod(editBilling.period);
      setForexSell(editBilling.forexSellingRate); setForexBuy(editBilling.forexBuyingRate);
      setBd(editBilling.bulkDiscountPct); setWht(editBilling.whtApplied); setNotes(editBilling.notes ?? "");
      setLines((editBilling.lines ?? []).map(l => ({
        partnerId: l.partnerId, partnerPurchaseOrderId: l.partnerPurchaseOrderId ?? null,
        items: l.items.map(it => ({ clientEventId: it.clientEventId, eventName: it.eventName, billableRate: it.billableRate, payoutRate: it.payoutRate, eventCount: it.eventCount })),
      })));
    } else if (open) {
      setClientId(null); setPeriod(""); setCpoId(null); setCpos([]); setPpos([]); setLines([]);
      setForexSell(0); setForexBuy(0); setBd(0); setWht(false); setNotes("");
    }
  }, [open, editBilling]);

  useEffect(() => {
    if (clientId && clients) {
      const c = clients.find(x => x.id === clientId);
      if (c?.bulkDiscountPct != null && !editBilling) setBd(c.bulkDiscountPct);
    }
  }, [clientId, clients, editBilling]);

  useEffect(() => {
    if (clientId && period) {
      fetch(`/api/clients/${clientId}/purchase-orders?period=${period}`).then(r => r.json())
        .then((rows: Cpo[]) => setCpos(rows)).catch(() => setCpos([]));
    } else setCpos([]);
  }, [clientId, period]);

  useEffect(() => {
    if (cpoId) {
      fetch(`/api/partner-purchase-orders?clientPurchaseOrderId=${cpoId}`).then(r => r.json())
        .then((rows: Ppo[]) => setPpos(rows)).catch(() => setPpos([]));
    } else setPpos([]);
  }, [cpoId]);

  const create = useCreateBilling({ mutation: {
    onSuccess: () => { onSuccess(); onClose(); toast({ title: "Billing created" }); },
    onError: () => toast({ title: "Failed to create billing", variant: "destructive" }),
  }});
  const update = useUpdateBilling({ mutation: {
    onSuccess: () => { onSuccess(); onClose(); toast({ title: "Billing updated" }); },
    onError: () => toast({ title: "Failed to update billing", variant: "destructive" }),
  }});

  const addLine = () => setLines(ls => [...ls, { partnerId: null, partnerPurchaseOrderId: null, items: [] }]);
  const removeLine = (i: number) => setLines(ls => ls.filter((_, idx) => idx !== i));

  const setLinePartner = async (i: number, partnerId: number) => {
    let events: PayableEvent[] = [];
    if (clientId) {
      try { events = await fetch(`/api/partners/${partnerId}/payable-events?clientId=${clientId}`).then(r => r.json()); } catch { /* keep empty */ }
    }
    setLines(ls => ls.map((l, idx) => idx === i ? {
      ...l, partnerId,
      partnerPurchaseOrderId: ppos.find(p => p.partnerId === partnerId)?.id ?? null,
      items: events.map(e => ({ clientEventId: e.clientEventId, eventName: e.name, billableRate: e.billableRate, payoutRate: e.payoutRate, eventCount: 0 })),
    } : l));
  };

  const setCount = (li: number, ii: number, count: number) =>
    setLines(ls => ls.map((l, idx) => idx === li
      ? { ...l, items: l.items.map((it, j) => j === ii ? { ...it, eventCount: count } : it) } : l));

  const preview = lines.reduce((acc, l) => {
    const c = computeBilling({
      events: l.items, forexSellingRate, forexBuyingRate,
      remittanceTaxPct: tax.remittanceTaxPct, salesTaxPct: tax.salesTaxPct,
      withholdingTaxPct: tax.withholdingTaxPct, bulkDiscountPct, whtApplied,
    });
    return { totalInvoice: acc.totalInvoice + c.totalInvoice, netMargin: acc.netMargin + c.netMargin };
  }, { totalInvoice: 0, netMargin: 0 });

  const submit = () => {
    if (!clientId || !cpoId || !period) { toast({ title: "Client, month and CPO are required", variant: "destructive" }); return; }
    const validLines = lines.filter(l => l.partnerId && l.items.length);
    if (!validLines.length) { toast({ title: "Add at least one partner line", variant: "destructive" }); return; }
    const data = {
      clientId, clientPurchaseOrderId: cpoId, period,
      forexSellingRate, forexBuyingRate, bulkDiscountPct, whtApplied, notes: notes || null,
      lines: validLines.map(l => ({
        partnerId: l.partnerId!, partnerPurchaseOrderId: l.partnerPurchaseOrderId,
        items: l.items.map(it => ({ clientEventId: it.clientEventId, eventName: it.eventName, billableRate: it.billableRate, payoutRate: it.payoutRate, eventCount: it.eventCount })),
      })),
    };
    if (editBilling) update.mutate({ id: editBilling.id, data });
    else create.mutate({ data });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editBilling ? "Edit Billing" : "Create Billing"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Client</span>
              <Select value={clientId ? String(clientId) : ""} onValueChange={v => setClientId(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
                <SelectContent>{clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Month</span>
              <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} />
            </label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Client PO</span>
              <Select value={cpoId ? String(cpoId) : ""} onValueChange={v => setCpoId(Number(v))}>
                <SelectTrigger><SelectValue placeholder="CPO" /></SelectTrigger>
                <SelectContent>{cpos.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.code}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          </div>

          {ppos.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <p className="font-medium mb-1">Partner POs under this CPO (reference)</p>
              {ppos.map(p => (
                <div key={p.id} className="text-muted-foreground">
                  {p.code} · {p.partnerName ?? `Partner ${p.partnerId}`}
                  {p.items?.length ? ` — ${p.items.map(i => `${i.eventName} ×${i.eventCount}`).join(", ")}` : ""}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {lines.map((l, li) => (
              <div key={li} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Select value={l.partnerId ? String(l.partnerId) : ""} onValueChange={v => setLinePartner(li, Number(v))}>
                    <SelectTrigger className="w-56"><SelectValue placeholder="Partner" /></SelectTrigger>
                    <SelectContent>{partners?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" className="ml-auto h-7 w-7 p-0 text-red-600" onClick={() => removeLine(li)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {l.items.length === 0 && l.partnerId && (
                  <p className="text-[11px] text-muted-foreground">No payable events configured for this partner + client.</p>
                )}
                {l.items.map((it, ii) => (
                  <div key={it.clientEventId} className="grid grid-cols-4 gap-2 items-center text-xs">
                    <span className="font-medium">{it.eventName}</span>
                    <span className="text-muted-foreground">Bill {it.billableRate} · Pay {it.payoutRate}</span>
                    <Input type="number" min={0} placeholder="Count" value={it.eventCount || ""}
                      onChange={e => setCount(li, ii, parseInt(e.target.value) || 0)} className="h-7" />
                    <span className="text-right">${fmt(it.eventCount * it.billableRate)}</span>
                  </div>
                ))}
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={addLine}><Plus className="h-3.5 w-3.5" /> Add Partner</Button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Forex Selling</span>
              <Input type="number" step="0.0001" value={forexSellingRate || ""} onChange={e => setForexSell(parseFloat(e.target.value) || 0)} /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Forex Buying</span>
              <Input type="number" step="0.0001" value={forexBuyingRate || ""} onChange={e => setForexBuy(parseFloat(e.target.value) || 0)} /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Bulk Discount %</span>
              <Input type="number" step="0.01" value={bulkDiscountPct || ""} onChange={e => setBd(parseFloat(e.target.value) || 0)} /></label>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={whtApplied} onCheckedChange={v => setWht(Boolean(v))} /> Apply Withholding Tax gross-up
          </label>

          <Textarea rows={2} placeholder="Notes..." value={notes} onChange={e => setNotes(e.target.value)} />

          <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-xs">
            <span>Total Invoice: <b>PKR {fmt(preview.totalInvoice)}</b></span>
            <span>Net Margin: <b>PKR {fmt(preview.netMargin)}</b></span>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending ? "Saving..." : editBilling ? "Update" : "Create Billing"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
