"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useListPartnerBills, useDeletePartnerBill, getListPartnerBillsQueryKey } from "@workspace/api-client-react";
import type { PartnerBill } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AgingPill } from "@/components/billings/AgingPill";
import { CreatePartnerBillDialog } from "@/components/billings/CreatePartnerBillDialog";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export function PartnerBillingTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: bills, isLoading } = useListPartnerBills();
  const [addOpen, setAddOpen] = useState(false);
  const [editBill, setEditBill] = useState<PartnerBill | null>(null);
  const del = useDeletePartnerBill({ mutation: {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListPartnerBillsQueryKey() }); toast({ title: "Partner bill deleted" }); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  }});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{bills?.length ?? 0} partner bills</p>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Record Partner Bill</Button>
      </div>
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["#", "PBILL Code", "Partner", "Client", "Their Inv #", "Amount (USD)", "Date Received", "Aging", "Attachment", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i} className="border-b border-border">{[...Array(10)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}</tr>)
            ) : !bills?.length ? (
              <tr><td colSpan={10} className="px-5 py-10 text-center text-sm text-muted-foreground">No partner bills yet</td></tr>
            ) : bills.map((b, i) => (
              <tr key={b.id} className="border-b border-border last:border-0 hover:bg-muted/20 text-xs">
                <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 font-semibold">{b.code}</td>
                <td className="px-3 py-2">{b.partnerName}</td>
                <td className="px-3 py-2">{b.clientName ?? "—"}</td>
                <td className="px-3 py-2">{b.partnerInvoiceNumber ?? "—"}</td>
                <td className="px-3 py-2 font-semibold">{fmt(b.amount)}</td>
                <td className="px-3 py-2">{b.dateReceived ? new Date(b.dateReceived).toLocaleDateString() : "—"}</td>
                <td className="px-3 py-2"><AgingPill start={b.dateReceived ?? null} termDays={b.partnerTermDays ?? null} settled={false} /></td>
                <td className="px-3 py-2">{b.attachmentUrl ? <a href={b.attachmentUrl} target="_blank" rel="noreferrer" className="text-primary underline text-[10px]">View</a> : "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditBill(b)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600" onClick={() => { if (confirm("Delete this partner bill?")) del.mutate({ id: b.id }); }}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CreatePartnerBillDialog open={addOpen || editBill != null} editBill={editBill ?? undefined}
        onClose={() => { setAddOpen(false); setEditBill(null); }}
        onSuccess={() => qc.invalidateQueries({ queryKey: getListPartnerBillsQueryKey() })} />
    </div>
  );
}
