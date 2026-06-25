"use client";

import { useState } from "react";
import { Plus, Trash2, Paperclip } from "lucide-react";
import {
  useListClientPurchaseOrders, useDeleteClientPurchaseOrder, getListClientPurchaseOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useHasPermission } from "@/lib/auth/user-context";
import { CreateClientPODialog } from "./CreateClientPODialog";

function fmtDate(s: string) { return new Date(s).toLocaleDateString(); }

export function ClientPOTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("Edit Purchase Orders");
  const { data: rows, isLoading } = useListClientPurchaseOrders();

  const del = useDeleteClientPurchaseOrder({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListClientPurchaseOrdersQueryKey() }); toast({ title: "Deleted" }); },
      onError: (e: unknown) => toast({ title: e instanceof Error ? e.message : "Delete failed", variant: "destructive" }),
    },
  });

  const headers = ["Sr.", "CPO ID", "Client", "Buying House", "Created", "Created By", canEdit ? "Actions" : null]
    .filter((h): h is string => h !== null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rows?.length ?? 0} client purchase orders</p>
        {canEdit && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)} data-testid="create-cpo-btn">
            <Plus className="h-3.5 w-3.5" /> Create Purchase Order
          </Button>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {headers.map(h => <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {headers.map((_, j) => <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>)}
                </tr>
              ))
            ) : (rows?.length ?? 0) === 0 ? (
              <tr><td colSpan={headers.length} className="px-5 py-10 text-center text-sm text-muted-foreground">No purchase orders yet</td></tr>
            ) : (
              rows!.map((r, i) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30" data-testid={`cpo-row-${r.id}`}>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{i + 1}</td>
                  <td className="px-5 py-3 text-sm font-medium">{r.code}</td>
                  <td className="px-5 py-3 text-sm">{r.clientName}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{r.buyingHouseName ?? "—"}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{fmtDate(r.createdAt)}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{r.createdByName ?? "—"}</td>
                  {canEdit && (
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <a href={r.attachmentUrl} target="_blank" rel="noreferrer" title="Attachment"
                           className="rounded p-1.5 text-muted-foreground hover:bg-muted"><Paperclip className="h-3.5 w-3.5" /></a>
                        <button onClick={() => del.mutate({ id: r.id })} title="Delete"
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          data-testid={`delete-cpo-${r.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CreateClientPODialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
