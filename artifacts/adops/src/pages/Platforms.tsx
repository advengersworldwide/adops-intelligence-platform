import { useState } from "react";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { useListPlatforms, useCreatePlatform, useUpdatePlatform, useDeletePlatform, getListPlatformsQueryKey, useGetAnalyticsByPlatform } from "@workspace/api-client-react";
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
import { cn } from "@/lib/utils";

const platformSchema = z.object({
  name: z.string().min(1, "Name is required"),
  costModel: z.string().min(1, "Cost model is required"),
  currency: z.string().min(1, "Currency is required"),
});
type PlatformForm = z.infer<typeof platformSchema>;

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function PlatformsPage() {
  const [search, setSearch] = useState("");
  const [editPlatform, setEditPlatform] = useState<{ id: number; name: string; costModel: string; currency: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: platforms, isLoading } = useListPlatforms();
  const { data: platformAnalytics } = useGetAnalyticsByPlatform();

  const analyticsMap = new Map((platformAnalytics ?? []).map(p => [p.platformId, p]));

  const createMutation = useCreatePlatform({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListPlatformsQueryKey() }); setCreateOpen(false); toast({ title: "Platform created" }); },
      onError: () => toast({ title: "Failed to create platform", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdatePlatform({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListPlatformsQueryKey() }); setEditPlatform(null); toast({ title: "Platform updated" }); },
      onError: () => toast({ title: "Failed to update platform", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeletePlatform({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListPlatformsQueryKey() }); toast({ title: "Platform deleted" }); },
      onError: () => toast({ title: "Failed to delete platform", variant: "destructive" }),
    },
  });

  const filtered = platforms?.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.costModel.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Platforms</h1>
          <p className="text-sm text-muted-foreground">{platforms?.length ?? 0} DSP platforms</p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)} data-testid="create-platform-btn">
          <Plus className="h-3.5 w-3.5" /> Add Platform
        </Button>
      </div>

      <div className="relative w-72">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search platforms..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm" />
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Name", "Cost Model", "Currency", "Revenue", "Cost", "Profit", "Margin %", "Actions"].map(h => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(8)].map((_, j) => <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>)}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">No platforms found</td></tr>
            ) : (
              filtered.map(p => {
                const an = analyticsMap.get(p.id);
                return (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`platform-row-${p.id}`}>
                    <td className="px-5 py-3 text-sm font-medium text-foreground">{p.name}</td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">{p.costModel}</td>
                    <td className="px-5 py-3">
                      <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">{p.currency}</span>
                    </td>
                    <td className="px-5 py-3 text-sm font-medium">{an ? fmt(an.revenue) : "—"}</td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">{an ? fmt(an.cost) : "—"}</td>
                    <td className={cn("px-5 py-3 text-sm font-semibold", an && an.profit < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                      {an ? fmt(an.profit) : "—"}
                    </td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">{an ? `${an.marginPct.toFixed(1)}%` : "—"}</td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => setEditPlatform(p)} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" data-testid={`edit-platform-${p.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => deleteMutation.mutate({ id: p.id })} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" data-testid={`delete-platform-${p.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <PlatformDialog
        open={createOpen || !!editPlatform}
        onClose={() => { setCreateOpen(false); setEditPlatform(null); }}
        defaultValues={editPlatform ? { name: editPlatform.name, costModel: editPlatform.costModel, currency: editPlatform.currency } : undefined}
        onSubmit={(data) => {
          if (editPlatform) updateMutation.mutate({ id: editPlatform.id, data });
          else createMutation.mutate({ data });
        }}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        title={editPlatform ? "Edit Platform" : "Add Platform"}
      />
    </div>
  );
}

function PlatformDialog({ open, onClose, defaultValues, onSubmit, isSubmitting, title }: {
  open: boolean; onClose: () => void; defaultValues?: PlatformForm;
  onSubmit: (data: PlatformForm) => void; isSubmitting: boolean; title: string;
}) {
  const form = useForm<PlatformForm>({
    resolver: zodResolver(platformSchema),
    defaultValues: defaultValues ?? { name: "", costModel: "CPM", currency: "USD" },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="e.g. The Trade Desk" {...field} data-testid="platform-name-input" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="costModel" render={({ field }) => (
              <FormItem><FormLabel>Cost Model</FormLabel><FormControl><Input placeholder="e.g. CPM, CPC, CPA" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="currency" render={({ field }) => (
              <FormItem><FormLabel>Currency</FormLabel><FormControl><Input placeholder="e.g. USD" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting} data-testid="submit-platform-btn">
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
