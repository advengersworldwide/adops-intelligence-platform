"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Eye, Pencil, ChevronRight, ChevronDown } from "lucide-react";
import {
  useListPartnerPurchaseOrders,
  useDeletePartnerPurchaseOrder,
  getListPartnerPurchaseOrdersQueryKey,
  type PartnerPurchaseOrder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useHasPermission } from "@/lib/auth/user-context";
import { CreatePartnerPODialog } from "./CreatePartnerPODialog";
import { useTableControls, TableSearch, TableFilter, SortableTh, distinctOptions } from "@/components/ui/table-controls";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s: string) => new Date(s).toLocaleDateString();

export function PartnerPOTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editPo, setEditPo] = useState<PartnerPurchaseOrder | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("purchase-orders:edit") ?? false;
  const { data: rows, isLoading } = useListPartnerPurchaseOrders();
  const { search, setSearch, sort, toggleSort, filterValues, setFilter, rows: filtered } = useTableControls({
    rows,
    searchAccessor: r => [r.code, r.partnerName, r.buyingHouseName, r.clientName, r.createdByName],
    sortAccessors: {
      code: r => r.code,
      partner: r => r.partnerName,
      house: r => r.buyingHouseName,
      client: r => r.clientName,
      budget: r => r.totalBudget,
      created: r => r.createdAt,
    },
    filters: [
      { key: "partner", label: "Partner", options: [], predicate: (r, v) => r.partnerName === v },
      { key: "client", label: "Client", options: [], predicate: (r, v) => r.clientName === v },
    ],
    initialSort: { key: "created", dir: "desc" },
  });
  const partnerOptions = distinctOptions(rows, r => r.partnerName);
  const clientOptions = distinctOptions(rows, r => r.clientName);

  const del = useDeletePartnerPurchaseOrder({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPartnerPurchaseOrdersQueryKey() });
        toast({ title: "Deleted" });
      },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    },
  });

  const colCount = canEdit ? 10 : 9;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{filtered.length} partner purchase orders</p>
        {canEdit && (
          <Button
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setCreateOpen(true)}
            data-testid="create-ppo-btn"
          >
            <Plus className="h-3.5 w-3.5" /> Create Purchase Order
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch value={search} onChange={setSearch} placeholder="Search PPO, partner, client, buying house…" />
        <TableFilter label="Partner" value={filterValues.partner} options={partnerOptions} onChange={v => setFilter("partner", v)} />
        <TableFilter label="Client" value={filterValues.client} options={clientOptions} onChange={v => setFilter("client", v)} />
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground"></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Sr.</th>
              <SortableTh label="PPO ID" sortKey="code" sort={sort} onSort={toggleSort} className="px-4 py-3 text-xs" />
              <SortableTh label="Partner" sortKey="partner" sort={sort} onSort={toggleSort} className="px-4 py-3 text-xs" />
              <SortableTh label="Buying House" sortKey="house" sort={sort} onSort={toggleSort} className="px-4 py-3 text-xs" />
              <SortableTh label="Client" sortKey="client" sort={sort} onSort={toggleSort} className="px-4 py-3 text-xs" />
              <SortableTh label="Total Budget" sortKey="budget" sort={sort} onSort={toggleSort} className="px-4 py-3 text-xs" />
              <SortableTh label="Created" sortKey="created" sort={sort} onSort={toggleSort} className="px-4 py-3 text-xs" />
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Created By</th>
              {canEdit && <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(colCount)].map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-16" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No partner purchase orders found
                </td>
              </tr>
            ) : (
              filtered.map((r, i) => (
                <PpoRow
                  key={r.id}
                  r={r}
                  i={i}
                  canEdit={canEdit}
                  colCount={colCount}
                  expanded={expanded === r.id}
                  onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                  onDelete={() => del.mutate({ id: r.id })}
                  onEdit={() => setEditPo(r)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <CreatePartnerPODialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <CreatePartnerPODialog open={!!editPo} editPo={editPo} onClose={() => setEditPo(null)} />
    </div>
  );
}

function PpoRow({
  r,
  i,
  canEdit,
  colCount,
  expanded,
  onToggle,
  onDelete,
  onEdit,
}: {
  r: {
    id: number;
    code: string;
    partnerName: string;
    buyingHouseName?: string | null;
    clientName: string;
    totalBudget: number;
    createdAt: string;
    createdByName?: string | null;
    items: Array<{
      id: number;
      eventName: string;
      cacRate: number;
      eventCount: number;
      lineBudget: number;
    }>;
  };
  i: number;
  canEdit: boolean;
  colCount: number;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  return (
    <>
      <tr className="border-b border-border hover:bg-muted/30" data-testid={`ppo-row-${r.id}`}>
        <td className="px-4 py-3">
          <button
            onClick={onToggle}
            data-testid={`ppo-expand-${r.id}`}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground">{i + 1}</td>
        <td className="px-4 py-3 text-sm font-medium">{r.code}</td>
        <td className="px-4 py-3 text-sm">{r.partnerName}</td>
        <td className="px-4 py-3 text-sm text-muted-foreground">{r.buyingHouseName ?? "—"}</td>
        <td className="px-4 py-3 text-sm">{r.clientName}</td>
        <td className="px-4 py-3 text-sm font-semibold">{money(r.totalBudget)}</td>
        <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDate(r.createdAt)}</td>
        <td className="px-4 py-3 text-sm text-muted-foreground">{r.createdByName ?? "—"}</td>
        {canEdit && (
          <td className="px-4 py-3">
            <div className="flex items-center gap-1">
              <Link
                href={`/purchase-orders/ppo/${r.id}`}
                title="View invoice"
                className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                data-testid={`view-ppo-${r.id}`}
              >
                <Eye className="h-3.5 w-3.5" />
              </Link>
              <button
                onClick={onEdit}
                title="Edit"
                className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                data-testid={`edit-ppo-${r.id}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onDelete}
                title="Delete"
                className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                data-testid={`delete-ppo-${r.id}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </td>
        )}
      </tr>
      {expanded && (
        <tr className="border-b border-border bg-muted/20">
          <td colSpan={colCount} className="px-10 py-3">
            <table className="w-full max-w-2xl">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="py-1 text-left font-medium">Payable Event</th>
                  <th className="py-1 text-left font-medium">CAC Rate</th>
                  <th className="py-1 text-left font-medium">Event Count</th>
                  <th className="py-1 text-left font-medium">Budget</th>
                </tr>
              </thead>
              <tbody>
                {r.items.map((it) => (
                  <tr key={it.id} className="text-sm">
                    <td className="py-1">{it.eventName}</td>
                    <td className="py-1">{it.cacRate}</td>
                    <td className="py-1">{it.eventCount.toLocaleString()}</td>
                    <td className="py-1">{money(it.lineBudget)}</td>
                  </tr>
                ))}
                <tr className="text-sm font-semibold border-t border-border">
                  <td className="py-1" colSpan={3}>
                    Total
                  </td>
                  <td className="py-1">{money(r.totalBudget)}</td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
