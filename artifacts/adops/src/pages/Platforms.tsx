import { useState, useEffect } from "react";
import { Plus, Trash2, Search } from "lucide-react";
import { Link } from "wouter";
import {
  useListPlatforms, useCreatePlatform, useDeletePlatform,
  getListPlatformsQueryKey, useGetAnalyticsByPlatform,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/auth";

const PAYMENT_TERMS = ["net_30", "net_60", "net_90", "net_120", "net_150"] as const;
const PAYMENT_LABEL: Record<string, string> = {
  net_30: "Net 30", net_60: "Net 60", net_90: "Net 90", net_120: "Net 120", net_150: "Net 150",
};

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  address: z.string().optional(),
  pocName: z.string().optional(),
  pocNumber: z.string().regex(/^[+\d\s()\-]*$/, "Invalid phone number").optional().or(z.literal("")),
  pocEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  companyEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  companyNumber: z.string().regex(/^[+\d\s()\-]*$/, "Invalid phone number").optional().or(z.literal("")),
  paymentTerms: z.enum(PAYMENT_TERMS).optional(),
});
type CreateForm = z.infer<typeof createSchema>;

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function PlatformsPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: platforms, isLoading } = useListPlatforms();
  const { data: platformAnalytics } = useGetAnalyticsByPlatform();
  const analyticsMap = new Map((platformAnalytics ?? []).map(p => [p.platformId, p]));

  const createMutation = useCreatePlatform({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPlatformsQueryKey() });
        setCreateOpen(false);
        toast({ title: "Platform created" });
      },
      onError: () => toast({ title: "Failed to create platform", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeletePlatform({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPlatformsQueryKey() });
        toast({ title: "Platform deleted" });
      },
      onError: () => toast({ title: "Failed to delete platform", variant: "destructive" }),
    },
  });

  const filtered = platforms?.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Platforms</h1>
          <p className="text-sm text-muted-foreground">{platforms?.length ?? 0} DSP platforms</p>
        </div>
        {hasPermission("Edit Platforms") && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)} data-testid="create-platform-btn">
            <Plus className="h-3.5 w-3.5" /> Add Platform
          </Button>
        )}
      </div>

      <div className="relative w-72">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search platforms..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm" />
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Name", "Payment Terms", "Cost Models", "Revenue", "Cost", "Profit", "Margin %", hasPermission("Edit Platforms") ? "Actions" : null]
                .filter((h): h is string => h !== null)
                .map(h => (
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
                    <td className="px-5 py-3 text-sm font-medium">
                      <Link href={`/platforms/${p.id}`} className="text-foreground hover:text-primary hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">
                      {p.paymentTerms ? PAYMENT_LABEL[p.paymentTerms] ?? p.paymentTerms : "—"}
                    </td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">
                      {p.costModels?.length ? p.costModels.map(cm => cm.name).join(", ") : "—"}
                    </td>
                    <td className="px-5 py-3 text-sm font-medium">{an ? fmt(an.revenue) : "—"}</td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">{an ? fmt(an.cost) : "—"}</td>
                    <td className={cn("px-5 py-3 text-sm font-semibold", an && an.profit < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                      {an ? fmt(an.profit) : "—"}
                    </td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">{an ? `${an.marginPct.toFixed(1)}%` : "—"}</td>
                    {hasPermission("Edit Platforms") && (
                      <td className="px-5 py-3">
                        <button
                          onClick={() => deleteMutation.mutate({ id: p.id })}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          data-testid={`delete-platform-${p.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <CreatePlatformDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(data) => createMutation.mutate({ data })}
        isSubmitting={createMutation.isPending}
      />
    </div>
  );
}

function CreatePlatformDialog({ open, onClose, onSubmit, isSubmitting }: {
  open: boolean; onClose: () => void;
  onSubmit: (data: CreateForm) => void; isSubmitting: boolean;
}) {
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", address: "", pocName: "", pocNumber: "", pocEmail: "", companyEmail: "", companyNumber: "" },
  });

  useEffect(() => {
    if (open) form.reset({ name: "", address: "", pocName: "", pocNumber: "", pocEmail: "", companyEmail: "", companyNumber: "" });
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Platform</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="e.g. The Trade Desk" {...field} data-testid="platform-name-input" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="address" render={({ field }) => (
              <FormItem><FormLabel>Address</FormLabel><FormControl><Input placeholder="Company address" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="pocName" render={({ field }) => (
                <FormItem><FormLabel>POC Name</FormLabel><FormControl><Input placeholder="Contact name" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="pocNumber" render={({ field }) => (
                <FormItem><FormLabel>POC Number</FormLabel><FormControl><Input type="tel" placeholder="+1 555 000" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="pocEmail" render={({ field }) => (
              <FormItem><FormLabel>POC Email</FormLabel><FormControl><Input type="email" placeholder="poc@platform.com" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="companyEmail" render={({ field }) => (
                <FormItem><FormLabel>Company Email</FormLabel><FormControl><Input type="email" placeholder="billing@platform.com" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="companyNumber" render={({ field }) => (
                <FormItem><FormLabel>Company Number</FormLabel><FormControl><Input type="tel" placeholder="Reg. number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="paymentTerms" render={({ field }) => (
              <FormItem><FormLabel>Payment Terms</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select terms" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {PAYMENT_TERMS.map(t => <SelectItem key={t} value={t}>{PAYMENT_LABEL[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting} data-testid="submit-platform-btn">
                {isSubmitting ? "Creating..." : "Create Platform"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
