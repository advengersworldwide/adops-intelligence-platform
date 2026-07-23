"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  useListPartnerPayments, useDeletePartnerPayment,
  getListPartnerPaymentsQueryKey, getListPartnerBillsQueryKey,
} from "@workspace/api-client-react";
import type { PartnerPayment } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { PartnerPaymentStatusSelect } from "@/components/payments/PartnerPaymentStatusSelect";
import { CreatePartnerPaymentDialog } from "@/components/payments/CreatePartnerPaymentDialog";
import { useTableControls, TableSearch, TableFilter, SortableTh, distinctOptions } from "@/components/ui/table-controls";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export function PartnerPaymentsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: payments, isLoading } = useListPartnerPayments();
  const [addOpen, setAddOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<PartnerPayment | null>(null);
  const { search, setSearch, sort, toggleSort, filterValues, setFilter, rows } = useTableControls({
    rows: payments,
    searchAccessor: p => [p.referenceCode, p.partnerName, p.clientName, p.partnerBillCode, p.sourceClientPaymentLabel],
    sortAccessors: {
      ref: p => p.referenceCode,
      partner: p => p.partnerName,
      client: p => p.clientName,
      bill: p => p.partnerBillCode,
      amount: p => p.amount,
      mode: p => p.mode,
      status: p => p.status,
      date: p => p.paymentDate,
    },
    filters: [
      { key: "status", label: "Status", options: [], predicate: (p, v) => p.status === v },
      { key: "partner", label: "Partner", options: [], predicate: (p, v) => p.partnerName === v },
    ],
    initialSort: { key: "date", dir: "desc" },
  });
  const partnerOptions = distinctOptions(payments, p => p.partnerName);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListPartnerPaymentsQueryKey() });
    qc.invalidateQueries({ queryKey: getListPartnerBillsQueryKey() });
  };
  const del = useDeletePartnerPayment({ mutation: {
    onSuccess: () => { refresh(); toast({ title: "Partner payment deleted" }); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  }});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rows.length} partner payments</p>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Record Partner Payment</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch value={search} onChange={setSearch} placeholder="Search partner, client, PBILL…" />
        <TableFilter label="Status" value={filterValues.status} options={[{ value: "pending", label: "Pending" }, { value: "settled", label: "Settled" }]} onChange={v => setFilter("status", v)} />
        <TableFilter label="Partner" value={filterValues.partner} options={partnerOptions} onChange={v => setFilter("partner", v)} />
      </div>
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">#</th>
              <SortableTh label="Ref" sortKey="ref" sort={sort} onSort={toggleSort} />
              <SortableTh label="Partner" sortKey="partner" sort={sort} onSort={toggleSort} />
              <SortableTh label="Client" sortKey="client" sort={sort} onSort={toggleSort} />
              <SortableTh label="Partner Bill" sortKey="bill" sort={sort} onSort={toggleSort} />
              <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">Funding Payment</th>
              <SortableTh label="Amount (USD)" sortKey="amount" sort={sort} onSort={toggleSort} />
              <SortableTh label="Mode" sortKey="mode" sort={sort} onSort={toggleSort} />
              <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
              <SortableTh label="Date" sortKey="date" sort={sort} onSort={toggleSort} />
              <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">Attachment</th>
              <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i} className="border-b border-border">{[...Array(12)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}</tr>)
            ) : !rows.length ? (
              <tr><td colSpan={12} className="px-5 py-10 text-center text-sm text-muted-foreground">No partner payments found</td></tr>
            ) : rows.map((p, i) => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/20 text-xs">
                <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground whitespace-nowrap">{p.referenceCode ?? "—"}</td>
                <td className="px-3 py-2">{p.partnerName}</td>
                <td className="px-3 py-2">{p.clientName ?? "—"}</td>
                <td className="px-3 py-2 font-semibold">{p.partnerBillCode}</td>
                <td className="px-3 py-2">{p.sourceClientPaymentLabel ?? "—"}</td>
                <td className="px-3 py-2 font-semibold">{fmt(p.amount)}</td>
                <td className="px-3 py-2 capitalize">{p.mode ?? "—"}</td>
                <td className="px-3 py-2"><PartnerPaymentStatusSelect paymentId={p.id} status={p.status} /></td>
                <td className="px-3 py-2">{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString() : "—"}</td>
                <td className="px-3 py-2">{p.attachmentUrl ? <a href={p.attachmentUrl} target="_blank" rel="noreferrer" className="text-primary underline text-[10px]">View</a> : "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditPayment(p)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600" onClick={() => { if (confirm("Delete this partner payment?")) del.mutate({ id: p.id }); }}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CreatePartnerPaymentDialog open={addOpen || editPayment != null} editPayment={editPayment ?? undefined}
        onClose={() => { setAddOpen(false); setEditPayment(null); }}
        onSuccess={refresh} />
    </div>
  );
}
