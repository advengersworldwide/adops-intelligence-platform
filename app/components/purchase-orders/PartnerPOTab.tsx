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

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s: string) => new Date(s).toLocaleDateString();

export function PartnerPOTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editPo, setEditPo] = useState<PartnerPurchaseOrder | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("Edit Purchase Orders") ?? false;
  const { data: rows, isLoading } = useListPartnerPurchaseOrders();

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
        <p className="text-sm text-muted-foreground">{rows?.length ?? 0} partner purchase orders</p>
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

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {[
                "",
                "Sr.",
                "PPO ID",
                "Partner",
                "Buying House",
                "Client",
                "Total Budget",
                "Created",
                "Created By",
                ...(canEdit ? ["Actions"] : []),
              ].map((h, i) => (
                <th key={i} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                  {h}
                </th>
              ))}
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
            ) : (rows?.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No partner purchase orders yet
                </td>
              </tr>
            ) : (
              rows!.map((r, i) => (
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
