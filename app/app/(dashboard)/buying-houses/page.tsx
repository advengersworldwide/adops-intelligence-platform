"use client";

import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, ChevronRight } from "lucide-react";
import Link from "next/link";
import {
  useListBuyingHouses, useCreateBuyingHouse, useUpdateBuyingHouse, useDeleteBuyingHouse,
  getListBuyingHousesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useHasPermission } from "@/lib/auth/user-context";
import { PermissionGuard } from "@/components/PermissionGuard";

const bhSchema = z.object({
  name: z.string().min(1, "Name is required"),
});
type BHForm = z.infer<typeof bhSchema>;

interface BHRow {
  id: number;
  name: string;
  clientCount: number;
  netMarginPkr: number;
  createdAt: string;
}

function fmtPkr(n: number) {
  return n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function BuyingHousesContent() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editBH, setEditBH] = useState<BHRow | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("buying-houses:edit");

  const { data: buyingHouses, isLoading } = useListBuyingHouses();

  const createMutation = useCreateBuyingHouse({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListBuyingHousesQueryKey() }); setCreateOpen(false); toast({ title: "Buying house created" }); },
      onError: () => toast({ title: "Failed to create", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateBuyingHouse({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListBuyingHousesQueryKey() }); setEditBH(null); toast({ title: "Buying house updated" }); },
      onError: () => toast({ title: "Failed to update", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteBuyingHouse({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListBuyingHousesQueryKey() }); toast({ title: "Buying house deleted" }); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Buying Houses</h1>
          <p className="text-sm text-muted-foreground">{buyingHouses?.length ?? 0} buying houses total</p>
        </div>
        {canEdit && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Buying House
          </Button>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Name", "Clients", "Net Margin (PKR)", canEdit ? "Actions" : null].filter((h): h is string => h !== null).map(h => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(4)].map((_, j) => <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-24" /></td>)}
                </tr>
              ))
            ) : !buyingHouses?.length ? (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-muted-foreground">No buying houses yet</td></tr>
            ) : (
              buyingHouses.map(bh => (
                <tr key={bh.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-3 text-sm font-medium text-foreground">
                    <Link href={`/buying-houses/${bh.id}`} className="flex items-center gap-1 hover:text-primary">
                      {bh.name} <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{bh.clientCount}</td>
                  <td className="px-5 py-3 text-sm font-medium"
                    style={{ color: bh.netMarginPkr >= 0 ? undefined : "rgb(220 38 38)" }}>
                    PKR {fmtPkr(bh.netMarginPkr)}
                  </td>
                  {canEdit && (
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => setEditBH(bh as BHRow)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => deleteMutation.mutate({ id: bh.id })}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <BHDialog
        open={createOpen || !!editBH}
        onClose={() => { setCreateOpen(false); setEditBH(null); }}
        defaultValues={editBH ? { name: editBH.name } : undefined}
        onSubmit={(data) => {
          if (editBH) updateMutation.mutate({ id: editBH.id, data });
          else createMutation.mutate({ data });
        }}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        title={editBH ? "Edit Buying House" : "Add Buying House"}
      />
    </div>
  );
}

function BHDialog({ open, onClose, defaultValues, onSubmit, isSubmitting, title }: {
  open: boolean; onClose: () => void; defaultValues?: BHForm;
  onSubmit: (data: BHForm) => void; isSubmitting: boolean; title: string;
}) {
  const form = useForm<BHForm>({
    resolver: zodResolver(bhSchema),
    defaultValues: defaultValues ?? { name: "" },
  });
  useEffect(() => {
    if (open) form.reset(defaultValues ?? { name: "" });
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl><Input placeholder="e.g. Starcom, GroupM" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save"}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function BuyingHousesPage() {
  return (
    <PermissionGuard permission="buying-houses:view">
      <BuyingHousesContent />
    </PermissionGuard>
  );
}
