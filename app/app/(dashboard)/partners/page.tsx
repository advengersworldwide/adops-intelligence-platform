"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, Search } from "lucide-react";
import Link from "next/link";
import {
  useListPartners, useCreatePartner,
  getListPartnersQueryKey,
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
import { derivePrefix } from "@/lib/po-codes";
import { useDeleteWithDependencies } from "@/hooks/use-delete-with-dependencies";
import { DeleteImpactDialog } from "@/components/ui/delete-impact-dialog";

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  codePrefix: z.string().regex(/^[A-Z0-9]{2,4}$/, "2–4 uppercase letters/numbers"),
  address: z.string().optional(),
  pocName: z.string().optional(),
  pocNumber: z.string().regex(/^[+\d\s()\-]*$/, "Invalid phone number").optional().or(z.literal("")),
  pocEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  companyEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  companyNumber: z.string().regex(/^[+\d\s()\-]*$/, "Invalid phone number").optional().or(z.literal("")),
  platformBulkDiscountPct: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

function PartnersPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("partners:edit");

  const { data: platforms, isLoading } = useListPartners();

  const createMutation = useCreatePartner({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPartnersQueryKey() });
        setCreateOpen(false);
        toast({ title: "Partner created" });
      },
      onError: () => toast({ title: "Failed to create partner", variant: "destructive" }),
    },
  });

  const del = useDeleteWithDependencies({
    table: "partners",
    invalidateKeys: [getListPartnersQueryKey()],
  });

  const filtered = platforms?.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Partners</h1>
          <p className="text-sm text-muted-foreground">{platforms?.length ?? 0} DSP partners</p>
        </div>
        {canEdit && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)} data-testid="create-platform-btn">
            <Plus className="h-3.5 w-3.5" /> Add Partner
          </Button>
        )}
      </div>

      <div className="relative w-72">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search partners..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm" />
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Name", "Payment Terms", canEdit ? "Actions" : null]
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
                  {[...Array(3)].map((_, j) => <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>)}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={3} className="px-5 py-10 text-center text-sm text-muted-foreground">No partners found</td></tr>
            ) : (
              filtered.map(p => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`platform-row-${p.id}`}>
                  <td className="px-5 py-3 text-sm font-medium">
                    <Link href={`/partners/${p.id}`} className="text-foreground hover:text-primary hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">
                    {p.paymentTermName ?? "—"}
                  </td>
                  {canEdit && (
                    <td className="px-5 py-3">
                      <button
                        onClick={() => del.start(p.id)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        data-testid={`delete-platform-${p.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CreatePlatformDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(data) => {
          const { platformBulkDiscountPct, ...rest } = data;
          createMutation.mutate({ data: { ...rest, platformBulkDiscountPct: platformBulkDiscountPct && platformBulkDiscountPct.trim() !== "" ? Number(platformBulkDiscountPct) : null } });
        }}
        isSubmitting={createMutation.isPending}
      />

      <DeleteImpactDialog {...del.dialogProps} />
    </div>
  );
}

function CreatePlatformDialog({ open, onClose, onSubmit, isSubmitting }: {
  open: boolean; onClose: () => void;
  onSubmit: (data: CreateForm) => void; isSubmitting: boolean;
}) {
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", codePrefix: "", address: "", pocName: "", pocNumber: "", pocEmail: "", companyEmail: "", companyNumber: "", platformBulkDiscountPct: "" },
  });

  const nameValue = form.watch("name");
  useEffect(() => {
    if (!form.getValues("codePrefix") && nameValue) {
      form.setValue("codePrefix", derivePrefix(nameValue), { shouldValidate: true });
    }
  }, [nameValue, form]);

  useEffect(() => {
    if (open) form.reset({ name: "", codePrefix: "", address: "", pocName: "", pocNumber: "", pocEmail: "", companyEmail: "", companyNumber: "", platformBulkDiscountPct: "" });
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Partner</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="e.g. The Trade Desk" {...field} data-testid="platform-name-input" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="codePrefix" render={({ field }) => (
              <FormItem>
                <FormLabel>PO Code Prefix</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. SB" maxLength={4}
                    {...field}
                    onChange={e => field.onChange(e.target.value.toUpperCase())}
                    data-testid="partner-prefix-input" />
                </FormControl>
                <p className="text-xs text-muted-foreground">2–4 letters/numbers. Used to generate partner PO codes (e.g. SB-0126-0001).</p>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="platformBulkDiscountPct" render={({ field }) => (
              <FormItem>
                <FormLabel>Bulk Discount %</FormLabel>
                <FormControl><Input type="number" step="0.01" placeholder="0" {...field} /></FormControl>
                <p className="text-xs text-muted-foreground">Discount taken from this partner, applied to their payout on billing-record uploads.</p>
                <FormMessage />
              </FormItem>
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
              <FormItem><FormLabel>POC Email</FormLabel><FormControl><Input type="email" placeholder="poc@ppartner.com" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="companyEmail" render={({ field }) => (
                <FormItem><FormLabel>Company Email</FormLabel><FormControl><Input type="email" placeholder="billing@partner.com" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="companyNumber" render={({ field }) => (
                <FormItem><FormLabel>Company Number</FormLabel><FormControl><Input type="tel" placeholder="Reg. number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
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

export default function PartnersRoute() {
  return (
    <PermissionGuard permission="partners:view">
      <PartnersPage />
    </PermissionGuard>
  );
}
