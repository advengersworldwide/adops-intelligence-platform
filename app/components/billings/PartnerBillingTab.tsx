"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useListPartnerBills, useDeletePartnerBill, getListPartnerBillsQueryKey } from "@workspace/api-client-react";
import type { PartnerBill } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AgingPill } from "@/components/billings/AgingPill";
import { CreatePartnerBillDialog } from "@/components/billings/CreatePartnerBillDialog";
import { useTableControls, TableSearch, TableFilter, SortableTh, distinctOptions } from "@/components/ui/table-controls";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

type PayStatus = "paid" | "partial" | "unpaid";
const PAY_STATUS_STYLES: Record<PayStatus, string> = {
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  unpaid: "bg-muted text-muted-foreground",
};
const PAY_STATUS_LABELS: Record<PayStatus, string> = { paid: "Paid", partial: "Partial", unpaid: "Unpaid" };
function billProgress(amount: number, amountPaid: number) {
  const pending = Math.max(0, amount - amountPaid);
  const pct = amount > 0 ? Math.min(100, (amountPaid / amount) * 100) : 0;
  const payStatus: PayStatus = pending <= 0.01 && amount > 0 ? "paid" : amountPaid > 0 ? "partial" : "unpaid";
  return { pending, pct, payStatus };
}

export function PartnerBillingTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: bills, isLoading } = useListPartnerBills();
  const [addOpen, setAddOpen] = useState(false);
  const [editBill, setEditBill] = useState<PartnerBill | null>(null);
  const { search, setSearch, sort, toggleSort, filterValues, setFilter, rows } = useTableControls({
    rows: bills,
    searchAccessor: b => [b.code, b.partnerName, b.clientName, b.partnerInvoiceNumber],
    sortAccessors: {
      code: b => b.code,
      partner: b => b.partnerName,
      client: b => b.clientName,
      amount: b => b.amount,
      paid: b => b.amountPaid,
      date: b => b.dateReceived,
    },
    filters: [
      { key: "partner", label: "Partner", options: [], predicate: (b, v) => b.partnerName === v },
      { key: "pay", label: "Payment", options: [], predicate: (b, v) => billProgress(b.amount, b.amountPaid).payStatus === v },
    ],
    initialSort: { key: "date", dir: "desc" },
  });
  const partnerOptions = distinctOptions(bills, b => b.partnerName);
  const del = useDeletePartnerBill({ mutation: {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListPartnerBillsQueryKey() }); toast({ title: "Partner bill deleted" }); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  }});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rows.length} partner bills</p>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Record Partner Bill</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch value={search} onChange={setSearch} placeholder="Search PBILL, partner, client, their inv#…" />
        <TableFilter label="Partner" value={filterValues.partner} options={partnerOptions} onChange={v => setFilter("partner", v)} />
        <TableFilter label="Payment" value={filterValues.pay} options={[{ value: "paid", label: "Paid" }, { value: "partial", label: "Partial" }, { value: "unpaid", label: "Unpaid" }]} onChange={v => setFilter("pay", v)} />
      </div>
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">#</th>
              <SortableTh label="PBILL Code" sortKey="code" sort={sort} onSort={toggleSort} />
              <SortableTh label="Partner" sortKey="partner" sort={sort} onSort={toggleSort} />
              <SortableTh label="Client" sortKey="client" sort={sort} onSort={toggleSort} />
              <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">Their Inv #</th>
              <SortableTh label="Amount (USD)" sortKey="amount" sort={sort} onSort={toggleSort} />
              <SortableTh label="Paid (USD)" sortKey="paid" sort={sort} onSort={toggleSort} />
              <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">Pending (USD)</th>
              <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">Progress</th>
              <SortableTh label="Date Received" sortKey="date" sort={sort} onSort={toggleSort} />
              <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">Aging</th>
              <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">Attachment</th>
              <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i} className="border-b border-border">{[...Array(13)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}</tr>)
            ) : !rows.length ? (
              <tr><td colSpan={13} className="px-5 py-10 text-center text-sm text-muted-foreground">No partner bills found</td></tr>
            ) : rows.map((b, i) => {
              const { pending, pct, payStatus } = billProgress(b.amount, b.amountPaid);
              return (
              <tr key={b.id} className="border-b border-border last:border-0 hover:bg-muted/20 text-xs">
                <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 font-semibold">{b.code}</td>
                <td className="px-3 py-2">{b.partnerName}</td>
                <td className="px-3 py-2">{b.clientName ?? "—"}</td>
                <td className="px-3 py-2">{b.partnerInvoiceNumber ?? "—"}</td>
                <td className="px-3 py-2 font-semibold">{fmt(b.amount)}</td>
                <td className="px-3 py-2">{fmt(b.amountPaid)}</td>
                <td className="px-3 py-2">{fmt(pending)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 min-w-[110px]">
                    <Progress value={pct} className="h-1.5 flex-1" />
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", PAY_STATUS_STYLES[payStatus])}>
                      {PAY_STATUS_LABELS[payStatus]}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">{b.dateReceived ? new Date(b.dateReceived).toLocaleDateString() : "—"}</td>
                <td className="px-3 py-2"><AgingPill start={b.dateReceived ?? null} termDays={b.partnerTermDays ?? null} settled={b.amount > 0 && b.amountPaid >= b.amount - 0.01} settledAt={b.settledAt} /></td>
                <td className="px-3 py-2">{b.attachmentUrl ? <a href={b.attachmentUrl} target="_blank" rel="noreferrer" className="text-primary underline text-[10px]">View</a> : "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditBill(b)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600" onClick={() => { if (confirm("Delete this partner bill?")) del.mutate({ id: b.id }); }}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CreatePartnerBillDialog open={addOpen || editBill != null} editBill={editBill ?? undefined}
        onClose={() => { setAddOpen(false); setEditBill(null); }}
        onSuccess={() => qc.invalidateQueries({ queryKey: getListPartnerBillsQueryKey() })} />
    </div>
  );
}
