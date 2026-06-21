"use client";

import { useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import {
  useListCostResources, useCreateCostResource, useUpdateCostResource, useDeleteCostResource,
  getListCostResourcesQueryKey,
} from "@workspace/api-client-react";
import type { CostResource } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PermissionGuard } from "@/components/PermissionGuard";

function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

const costSchema = z.object({
  name: z.string().min(1, "Name is required"),
  amount: z.number().min(0),
  period: z.string().min(1, "Period is required"),
  notes: z.string().optional(),
});
type CostForm = z.infer<typeof costSchema>;

export default function CostPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<CostResource | null>(null);
  const [periodFilter, setPeriodFilter] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: resources, isLoading } = useListCostResources(periodFilter ? { period: periodFilter } : {});
  const deleteMutation = useDeleteCostResource({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListCostResourcesQueryKey() }); toast({ title: "Cost resource deleted" }); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  const totalForPeriod = (resources ?? []).reduce((s, r) => s + r.amount, 0);

  return (
    <PermissionGuard permission="View Cost">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Cost</h1>
            <p className="text-sm text-muted-foreground">{resources?.length ?? 0} resources{periodFilter ? ` · Total: PKR ${fmtNum(totalForPeriod)}` : ""}</p>
          </div>
          <div className="flex gap-2 items-center">
            <Input type="month" className="w-36 text-sm" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} />
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Cost
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["#", "Resource Name", "Period", "Amount (PKR)", "Notes", "Added By", "Date", "Actions"].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {[...Array(8)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                  </tr>
                ))
              ) : !(resources ?? []).length ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">No cost resources</td></tr>
              ) : (resources ?? []).map((r, i) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2 text-xs font-semibold">{r.name}</td>
                  <td className="px-3 py-2 text-xs">{r.period}</td>
                  <td className="px-3 py-2 text-xs font-semibold">{fmtNum(r.amount)}</td>
                  <td className="px-3 py-2 text-xs max-w-[200px] truncate">{r.notes ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.createdBy ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditItem(r)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600"
                        onClick={() => { if (confirm("Delete this cost resource?")) deleteMutation.mutate({ id: r.id }); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {(resources ?? []).length > 0 && (
                <tr className="border-t-2 border-border bg-muted/30">
                  <td className="px-3 py-2 text-xs font-semibold" colSpan={3}>Total</td>
                  <td className="px-3 py-2 text-xs font-semibold">{fmtNum(totalForPeriod)}</td>
                  <td colSpan={4} />
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <CostDialog
          open={addOpen || editItem != null}
          editItem={editItem ?? undefined}
          onClose={() => { setAddOpen(false); setEditItem(null); }}
          onSuccess={() => qc.invalidateQueries({ queryKey: getListCostResourcesQueryKey() })}
        />
      </div>
    </PermissionGuard>
  );
}

function CostDialog({ open, editItem, onClose, onSuccess }: {
  open: boolean; editItem?: CostResource; onClose: () => void; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const isEdit = editItem != null;
  const form = useForm<CostForm>({
    resolver: zodResolver(costSchema),
    defaultValues: {
      name: editItem?.name ?? "",
      amount: editItem?.amount ?? 0,
      period: editItem?.period ?? new Date().toISOString().slice(0, 7),
      notes: editItem?.notes ?? "",
    },
  });

  const createMutation = useCreateCostResource({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Cost resource added" }); },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateCostResource({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Updated" }); },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    },
  });

  const onSubmit = (data: CostForm) => {
    const body = { name: data.name, amount: data.amount, period: data.period, notes: data.notes ?? null };
    if (isEdit) updateMutation.mutate({ id: editItem.id, data: body });
    else createMutation.mutate({ data: body });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Cost Resource" : "Add Cost Resource"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Resource Name</FormLabel>
                <FormControl><Input placeholder="e.g. Office Rent, Salaries" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem><FormLabel>Amount (PKR)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" min={0} {...field}
                      value={field.value ?? ""} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="period" render={({ field }) => (
                <FormItem><FormLabel>Period</FormLabel>
                  <FormControl><Input type="month" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes</FormLabel>
                <FormControl><Textarea rows={2} placeholder="Optional notes..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? "Saving..." : isEdit ? "Update" : "Add"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
