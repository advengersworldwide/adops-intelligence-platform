"use client";

import { useState } from "react";
import { Plus, ChevronRight, Pencil, Trash2 } from "lucide-react";
import {
  useListBillings, useDeleteBilling, getListBillingsQueryKey,
} from "@workspace/api-client-react";
import type { BillingSummary, BillingDetail } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { computeBilling } from "@/lib/compute-billing";
import { cn } from "@/lib/utils";
import { PermissionGuard } from "@/components/PermissionGuard";
import { CreateBillingDialog } from "@/components/billings/CreateBillingDialog";
import { StatusSelect } from "@/components/billings/StatusSelect";
import { AgingPill } from "@/components/billings/AgingPill";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

type PayStatus = "paid" | "partial" | "unpaid";

const PAY_STATUS_STYLES: Record<PayStatus, string> = {
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  unpaid: "bg-muted text-muted-foreground",
};

const PAY_STATUS_LABELS: Record<PayStatus, string> = {
  paid: "Paid",
  partial: "Partial",
  unpaid: "Unpaid",
};

function paymentProgress(b: BillingSummary) {
  const paid = b.amountPaid;
  const pending = Math.max(0, b.netReceivable - b.amountPaid);
  const pct = b.netReceivable > 0 ? Math.min(100, (b.amountPaid / b.netReceivable) * 100) : 0;
  const payStatus: PayStatus = pending <= 0.01 && b.netReceivable > 0 ? "paid" : b.amountPaid > 0 ? "partial" : "unpaid";
  return { paid, pending, pct, payStatus };
}

function lineCompute(b: BillingSummary, line: BillingSummary["lines"][number]) {
  return computeBilling({
    events: line.items.map(it => ({ eventCount: it.eventCount, billableRate: it.billableRate, payoutRate: it.payoutRate })),
    forexSellingRate: b.forexSellingRate, forexBuyingRate: b.forexBuyingRate,
    remittanceTaxPct: b.remittanceTaxPct, salesTaxPct: b.salesTaxPct,
    withholdingTaxPct: b.withholdingTaxPct, bulkDiscountPct: b.bulkDiscountPct, whtApplied: b.whtApplied,
  });
}

export default function BillingSummaryPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: billings, isLoading } = useListBillings({});
  const [addOpen, setAddOpen] = useState(false);
  const [editBilling, setEditBilling] = useState<BillingDetail | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const del = useDeleteBilling({ mutation: {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListBillingsQueryKey() }); toast({ title: "Billing deleted" }); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  }});

  const openEdit = async (id: number) => {
    const detail: BillingDetail = await fetch(`/api/billings/${id}`).then(r => r.json());
    setEditBilling(detail);
  };

  return (
    <PermissionGuard permission="View Billings">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Billing Summary</h1>
            <p className="text-sm text-muted-foreground">{billings?.length ?? 0} billings</p>
          </div>
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Create Billing
          </Button>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["", "Client", "Partner(s)", "Agency", "Month", "CPO", "Total Invoice (PKR)", "Paid (PKR)", "Pending (PKR)", "Progress", "Aging", "Status", "Actions"].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border">{[...Array(13)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}</tr>
                ))
              ) : !billings?.length ? (
                <tr><td colSpan={13} className="px-5 py-10 text-center text-sm text-muted-foreground">No billings yet</td></tr>
              ) : billings.map(b => (
                <BillingGroup key={b.id} b={b} expanded={expanded === b.id}
                  onToggle={() => setExpanded(expanded === b.id ? null : b.id)}
                  onEdit={() => openEdit(b.id)}
                  onDelete={() => { if (confirm("Delete this billing?")) del.mutate({ id: b.id }); }} />
              ))}
            </tbody>
          </table>
        </div>

        <CreateBillingDialog open={addOpen || editBilling != null} editBilling={editBilling ?? undefined}
          onClose={() => { setAddOpen(false); setEditBilling(null); }}
          onSuccess={() => qc.invalidateQueries({ queryKey: getListBillingsQueryKey() })} />
      </div>
    </PermissionGuard>
  );
}

function BillingGroup({ b, expanded, onToggle, onEdit, onDelete }: {
  b: BillingSummary; expanded: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const { paid, pending, pct, payStatus } = paymentProgress(b);
  const settled = b.netReceivable > 0 && b.amountPaid >= b.netReceivable - 0.01;

  return (
    <>
      <tr className="border-b border-border hover:bg-muted/20">
        <td className="px-3 py-2">
          <button onClick={onToggle}><ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} /></button>
        </td>
        <td className="px-3 py-2 text-xs font-semibold">{b.clientName}</td>
        <td className="px-3 py-2 text-xs">
          {[...new Set(b.lines.map(l => l.partnerName))].join(", ") || "—"}
        </td>
        <td className="px-3 py-2 text-xs">{b.buyingHouseName ?? "—"}</td>
        <td className="px-3 py-2 text-xs">{b.period}</td>
        <td className="px-3 py-2 text-xs">{b.cpoCode}</td>
        <td className="px-3 py-2 text-xs font-semibold">{fmt(b.totalInvoice)}</td>
        <td className="px-3 py-2 text-xs">{fmt(paid)}</td>
        <td className="px-3 py-2 text-xs">{fmt(pending)}</td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2 min-w-[110px]">
            <Progress value={pct} className="h-1.5 flex-1" />
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", PAY_STATUS_STYLES[payStatus])}>
              {PAY_STATUS_LABELS[payStatus]}
            </span>
          </div>
        </td>
        <td className="px-3 py-2">
          <AgingPill start={b.invoiceGeneratedAt ?? null} termDays={b.paymentTermDays ?? null} settled={settled} />
        </td>
        <td className="px-3 py-2"><StatusSelect billingId={b.id} status={b.status} /></td>
        <td className="px-3 py-2">
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onEdit}><Pencil className="h-3 w-3" /></Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
          </div>
        </td>
      </tr>
      {expanded && b.lines.map(line => {
        const c = lineCompute(b, line);
        return (
          <tr key={line.id} className="border-b border-border bg-muted/10 text-xs">
            <td></td>
            <td className="px-3 py-2" colSpan={2}>
              <span className="font-medium">{line.partnerName}</span>
              <span className="text-muted-foreground ml-2">
                {line.items.map(it => `${it.eventName} ×${it.eventCount} @ ${it.billableRate}`).join("  ·  ")}
              </span>
            </td>
            <td className="px-3 py-2" colSpan={2}>USD {fmt(c.netTotalUsd)} · Forex {b.forexSellingRate} · PKR {fmt(c.netTotalPkr)}</td>
            <td className="px-3 py-2">Gross {fmt(c.grossTotalPkr)} · Tax {fmt(c.salesTax)} · <b>Inv {fmt(c.totalInvoice)}</b></td>
            <td colSpan={7}></td>
          </tr>
        );
      })}
    </>
  );
}
