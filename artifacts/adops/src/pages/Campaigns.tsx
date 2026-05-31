import { useState } from "react";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { useListCampaigns, useCreateCampaign, useUpdateCampaign, useDeleteCampaign, getListCampaignsQueryKey, useListClients, useListPlatforms } from "@workspace/api-client-react";
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

const campaignSchema = z.object({
  name: z.string().min(1, "Name is required"),
  clientId: z.coerce.number().min(1, "Client is required"),
  platformId: z.coerce.number().min(1, "Platform is required"),
});
type CampaignForm = z.infer<typeof campaignSchema>;

export default function CampaignsPage() {
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [editCampaign, setEditCampaign] = useState<{ id: number; name: string; clientId: number; platformId: number } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const params = {
    ...(clientFilter !== "all" ? { clientId: parseInt(clientFilter) } : {}),
    ...(platformFilter !== "all" ? { platformId: parseInt(platformFilter) } : {}),
  };

  const { data: campaigns, isLoading } = useListCampaigns(params);
  const { data: clients } = useListClients();
  const { data: platforms } = useListPlatforms();

  const createMutation = useCreateCampaign({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() }); setCreateOpen(false); toast({ title: "Campaign created" }); },
      onError: () => toast({ title: "Failed to create campaign", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateCampaign({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() }); setEditCampaign(null); toast({ title: "Campaign updated" }); },
      onError: () => toast({ title: "Failed to update campaign", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteCampaign({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() }); toast({ title: "Campaign deleted" }); },
      onError: () => toast({ title: "Failed to delete campaign", variant: "destructive" }),
    },
  });

  const filtered = campaigns?.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.clientName ?? "").toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Campaigns</h1>
          <p className="text-sm text-muted-foreground">{campaigns?.length ?? 0} campaigns</p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)} data-testid="create-campaign-btn">
          <Plus className="h-3.5 w-3.5" /> Add Campaign
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search campaigns..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm" />
        </div>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-44 text-sm" data-testid="client-filter">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-44 text-sm" data-testid="platform-filter">
            <SelectValue placeholder="All platforms" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {platforms?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Campaign Name", "Client", "Platform", "Created", "Actions"].map(h => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(5)].map((_, j) => <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-24" /></td>)}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-muted-foreground">No campaigns found</td></tr>
            ) : (
              filtered.map(c => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`campaign-row-${c.id}`}>
                  <td className="px-5 py-3 text-sm font-medium text-foreground">{c.name}</td>
                  <td className="px-5 py-3">
                    <span className="rounded-full bg-blue-100 dark:bg-blue-900/40 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                      {c.clientName ?? "—"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="rounded-full bg-purple-100 dark:bg-purple-900/40 px-2.5 py-0.5 text-xs font-medium text-purple-700 dark:text-purple-300">
                      {c.platformName ?? "—"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => setEditCampaign({ id: c.id, name: c.name, clientId: c.clientId, platformId: c.platformId })} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" data-testid={`edit-campaign-${c.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => deleteMutation.mutate({ id: c.id })} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" data-testid={`delete-campaign-${c.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CampaignDialog
        open={createOpen || !!editCampaign}
        onClose={() => { setCreateOpen(false); setEditCampaign(null); }}
        defaultValues={editCampaign ? { name: editCampaign.name, clientId: editCampaign.clientId, platformId: editCampaign.platformId } : undefined}
        onSubmit={(data) => {
          if (editCampaign) updateMutation.mutate({ id: editCampaign.id, data });
          else createMutation.mutate({ data });
        }}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        title={editCampaign ? "Edit Campaign" : "Add Campaign"}
        clients={clients ?? []}
        platforms={platforms ?? []}
      />
    </div>
  );
}

function CampaignDialog({ open, onClose, defaultValues, onSubmit, isSubmitting, title, clients, platforms }: {
  open: boolean; onClose: () => void; defaultValues?: CampaignForm;
  onSubmit: (data: CampaignForm) => void; isSubmitting: boolean; title: string;
  clients: Array<{ id: number; name: string }>; platforms: Array<{ id: number; name: string }>;
}) {
  const form = useForm<CampaignForm>({
    resolver: zodResolver(campaignSchema),
    defaultValues: defaultValues ?? { name: "", clientId: 0, platformId: 0 },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Campaign Name</FormLabel><FormControl><Input placeholder="e.g. Q1 Brand Awareness" {...field} data-testid="campaign-name-input" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="clientId" render={({ field }) => (
              <FormItem>
                <FormLabel>Client</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} defaultValue={field.value ? String(field.value) : undefined}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {clients.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="platformId" render={({ field }) => (
              <FormItem>
                <FormLabel>Platform</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} defaultValue={field.value ? String(field.value) : undefined}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select platform" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {platforms.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting} data-testid="submit-campaign-btn">{isSubmitting ? "Saving..." : "Save"}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
