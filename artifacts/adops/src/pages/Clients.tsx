import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Search, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import {
  useListClients, useCreateClient, useUpdateClient, useDeleteClient,
  getListClientsQueryKey, useListBuyingHouses,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/auth";

const clientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  buyingHouseId: z.number().nullable().optional(),
  pricingModel: z.enum(["fixed", "percentage"]),
  marginValue: z.coerce.number().optional().nullable(),
});
type ClientForm = z.infer<typeof clientSchema>;

interface ClientRow {
  id: number; name: string;
  buyingHouseId: number | null; buyingHouseName: string | null;
  pricingModel: string; marginValue?: number | null; createdAt: string;
}

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [editClient, setEditClient] = useState<ClientRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: clients, isLoading } = useListClients();
  const { data: buyingHouses } = useListBuyingHouses();

  const createMutation = useCreateClient({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListClientsQueryKey() }); setCreateOpen(false); toast({ title: "Client created" }); },
      onError: () => toast({ title: "Failed to create client", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateClient({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListClientsQueryKey() }); setEditClient(null); toast({ title: "Client updated" }); },
      onError: () => toast({ title: "Failed to update client", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteClient({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListClientsQueryKey() }); toast({ title: "Client deleted" }); },
      onError: () => toast({ title: "Failed to delete client", variant: "destructive" }),
    },
  });

  const filtered = clients?.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.buyingHouseName ?? "").toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Clients</h1>
          <p className="text-sm text-muted-foreground">{clients?.length ?? 0} clients total</p>
        </div>
        {hasPermission("Edit Clients") && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)} data-testid="create-client-btn">
            <Plus className="h-3.5 w-3.5" /> Add Client
          </Button>
        )}
      </div>

      <div className="relative w-72">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)}
          className="pl-9 text-sm" data-testid="client-search" />
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Name", "Buying House", "Pricing Model", "Margin Value", "Created", hasPermission("Edit Clients") ? "Actions" : null]
                .filter((h): h is string => h !== null)
                .map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(6)].map((_, j) => <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-24" /></td>)}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">No clients found</td></tr>
            ) : (
              filtered.map(c => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`client-row-${c.id}`}>
                  <td className="px-5 py-3 text-sm font-medium text-foreground">
                    <Link href={`/clients/${c.id}`} className="flex items-center gap-1 hover:text-primary">
                      {c.name} <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{c.buyingHouseName ?? "—"}</td>
                  <td className="px-5 py-3">
                    <span className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      c.pricingModel === "fixed"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                        : "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                    )}>
                      {c.pricingModel}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">
                    {c.marginValue != null ? (c.pricingModel === "percentage" ? `${c.marginValue}%` : `$${c.marginValue}`) : "—"}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                  {hasPermission("Edit Clients") && (
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => setEditClient(c as ClientRow)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          data-testid={`edit-client-${c.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => deleteMutation.mutate({ id: c.id })}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          data-testid={`delete-client-${c.id}`}>
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

      <ClientDialog
        open={createOpen || !!editClient}
        onClose={() => { setCreateOpen(false); setEditClient(null); }}
        buyingHouses={buyingHouses ?? []}
        defaultValues={editClient ? {
          name: editClient.name,
          buyingHouseId: editClient.buyingHouseId ?? null,
          pricingModel: editClient.pricingModel as "fixed" | "percentage",
          marginValue: editClient.marginValue ?? null,
        } : undefined}
        onSubmit={(data) => {
          if (editClient) updateMutation.mutate({ id: editClient.id, data });
          else createMutation.mutate({ data });
        }}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        title={editClient ? "Edit Client" : "Add Client"}
      />
    </div>
  );
}

function ClientDialog({ open, onClose, defaultValues, onSubmit, isSubmitting, title, buyingHouses }: {
  open: boolean; onClose: () => void; defaultValues?: ClientForm;
  onSubmit: (data: ClientForm) => void; isSubmitting: boolean; title: string;
  buyingHouses: Array<{ id: number; name: string }>;
}) {
  const form = useForm<ClientForm>({
    resolver: zodResolver(clientSchema),
    defaultValues: defaultValues ?? { name: "", buyingHouseId: null, pricingModel: "fixed", marginValue: null },
  });

  useEffect(() => {
    if (open) form.reset(defaultValues ?? { name: "", buyingHouseId: null, pricingModel: "fixed", marginValue: null });
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
                <FormControl><Input placeholder="Client name" {...field} data-testid="client-name-input" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="buyingHouseId" render={({ field }) => (
              <FormItem>
                <FormLabel>Buying House <span className="text-muted-foreground">(optional)</span></FormLabel>
                <Select
                  onValueChange={v => field.onChange(v === "none" ? null : parseInt(v))}
                  value={field.value != null ? String(field.value) : "none"}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select buying house" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {buyingHouses.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="pricingModel" render={({ field }) => (
              <FormItem>
                <FormLabel>Pricing Model</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed</SelectItem>
                    <SelectItem value="percentage">Percentage</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="marginValue" render={({ field }) => (
              <FormItem>
                <FormLabel>Margin Value</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="e.g. 15" {...field}
                    value={field.value ?? ""}
                    onChange={e => field.onChange(e.target.value === "" ? null : parseFloat(e.target.value))} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting} data-testid="submit-client-btn">
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
