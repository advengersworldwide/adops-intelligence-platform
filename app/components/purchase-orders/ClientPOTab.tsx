"use client";

import { useState } from "react";
import { Plus, Trash2, Paperclip, Eye, Pencil } from "lucide-react";
import {
  useListClientPurchaseOrders, useDeleteClientPurchaseOrder, getListClientPurchaseOrdersQueryKey,
  type ClientPurchaseOrder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useHasPermission } from "@/lib/auth/user-context";
import { CreateClientPODialog } from "./CreateClientPODialog";
import { ClientPODetailDialog } from "./ClientPODetailDialog";
import { useTableControls, TableSearch, TableFilter, SortableTh, distinctOptions } from "@/components/ui/table-controls";

function fmtDate(s: string) { return new Date(s).toLocaleDateString(); }

export function ClientPOTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<{ po: ClientPurchaseOrder; edit: boolean } | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("purchase-orders:edit");
  const { data: rows, isLoading } = useListClientPurchaseOrders();
  const { search, setSearch, sort, toggleSort, filterValues, setFilter, rows: filtered } = useTableControls({
    rows,
    searchAccessor: r => [r.code, r.clientName, r.buyingHouseName, r.createdByName],
    sortAccessors: {
      code: r => r.code,
      client: r => r.clientName,
      house: r => r.buyingHouseName,
      received: r => r.receiveDate,
      created: r => r.createdAt,
    },
    filters: [
      { key: "client", label: "Client", options: [], predicate: (r, v) => r.clientName === v },
      { key: "house", label: "Buying House", options: [], predicate: (r, v) => r.buyingHouseName === v },
    ],
    initialSort: { key: "created", dir: "desc" },
  });
  const clientOptions = distinctOptions(rows, r => r.clientName);
  const houseOptions = distinctOptions(rows, r => r.buyingHouseName);

  const del = useDeleteClientPurchaseOrder({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListClientPurchaseOrdersQueryKey() }); toast({ title: "Deleted" }); },
      onError: (e: unknown) => toast({ title: e instanceof Error ? e.message : "Delete failed", variant: "destructive" }),
    },
  });

  const headers = ["Sr.", "CPO ID", "Client", "Buying House", "Received", "Duration", "Created", "Created By", canEdit ? "Actions" : null]
    .filter((h): h is string => h !== null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{filtered.length} client purchase orders</p>
        {canEdit && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)} data-testid="create-cpo-btn">
            <Plus className="h-3.5 w-3.5" /> Create Purchase Order
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch value={search} onChange={setSearch} placeholder="Search CPO, client, buying house…" />
        <TableFilter label="Client" value={filterValues.client} options={clientOptions} onChange={v => setFilter("client", v)} />
        <TableFilter label="Buying House" value={filterValues.house} options={houseOptions} onChange={v => setFilter("house", v)} />
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Sr.</th>
              <SortableTh label="CPO ID" sortKey="code" sort={sort} onSort={toggleSort} className="px-5 py-3 text-xs" />
              <SortableTh label="Client" sortKey="client" sort={sort} onSort={toggleSort} className="px-5 py-3 text-xs" />
              <SortableTh label="Buying House" sortKey="house" sort={sort} onSort={toggleSort} className="px-5 py-3 text-xs" />
              <SortableTh label="Received" sortKey="received" sort={sort} onSort={toggleSort} className="px-5 py-3 text-xs" />
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Duration</th>
              <SortableTh label="Created" sortKey="created" sort={sort} onSort={toggleSort} className="px-5 py-3 text-xs" />
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Created By</th>
              {canEdit && <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {headers.map((_, j) => <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>)}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={headers.length} className="px-5 py-10 text-center text-sm text-muted-foreground">No purchase orders found</td></tr>
            ) : (
              filtered.map((r, i) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30" data-testid={`cpo-row-${r.id}`}>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{i + 1}</td>
                  <td className="px-5 py-3 text-sm font-medium">{r.code}</td>
                  <td className="px-5 py-3 text-sm">{r.clientName}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{r.buyingHouseName ?? "—"}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground whitespace-nowrap">{r.receiveDate ? fmtDate(r.receiveDate) : "—"}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground whitespace-nowrap">
                    {r.startDate || r.endDate ? `${r.startDate ? fmtDate(r.startDate) : "—"} – ${r.endDate ? fmtDate(r.endDate) : "—"}` : "—"}
                  </td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{fmtDate(r.createdAt)}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{r.createdByName ?? "—"}</td>
                  {canEdit && (
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setDetail({ po: r, edit: false })} title="View"
                          className="rounded p-1.5 text-muted-foreground hover:bg-muted" data-testid={`view-cpo-${r.id}`}><Eye className="h-3.5 w-3.5" /></button>
                        <button onClick={() => setDetail({ po: r, edit: true })} title="Edit"
                          className="rounded p-1.5 text-muted-foreground hover:bg-muted" data-testid={`edit-cpo-${r.id}`}><Pencil className="h-3.5 w-3.5" /></button>
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
      <ClientPODetailDialog po={detail?.po ?? null} startInEdit={detail?.edit ?? false} onClose={() => setDetail(null)} />
    </div>
  );
}
