"use client";

import { useState, useRef } from "react";
import { Plus, Trash2, Pencil, Upload } from "lucide-react";
import {
  useListPayments, useCreatePayment, useUpdatePayment, useDeletePayment,
  useListBillings,
  getListPaymentsQueryKey,
} from "@workspace/api-client-react";
import type { PaymentDetail } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const allocationSchema = z.object({
  billingId: z.number(),
  amountApplied: z.number().min(0),
});

const paymentSchema = z.object({
  mode: z.enum(["cash", "cheque", "online"], { required_error: "Mode is required" }),
  notes: z.string().optional(),
  chequeImageUrl: z.string().optional(),
  receiptUrl: z.string().optional(),
  paymentDate: z.string().optional(),
  allocations: z.array(allocationSchema).min(1, "Select at least one bill"),
});
type PaymentForm = z.infer<typeof paymentSchema>;

async function uploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/uploads/payment-attachment", { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  const { url } = await res.json();
  return url as string;
}

export default function PaymentsPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<PaymentDetail | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: payments, isLoading } = useListPayments();
  const deleteMutation = useDeletePayment({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListPaymentsQueryKey() }); toast({ title: "Payment deleted" }); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  return (
    <PermissionGuard permission="View Payments">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Payments</h1>
            <p className="text-sm text-muted-foreground">{payments?.length ?? 0} payments</p>
          </div>
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Record Payment
          </Button>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["#", "Mode", "Total (PKR)", "Billings", "Notes", "Date Received", "Created", "Attachments", "Actions"].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {[...Array(9)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                  </tr>
                ))
              ) : !payments?.length ? (
                <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-muted-foreground">No payments yet</td></tr>
              ) : payments.map((p, i) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2 text-xs font-semibold capitalize">{p.mode}</td>
                  <td className="px-3 py-2 text-xs font-semibold">{fmtNum(p.totalAmount)}</td>
                  <td className="px-3 py-2 text-xs">
                    {p.allocations.map(a => (
                      <div key={a.billingId} className="text-[10px]">
                        {a.billingLabel}: PKR {fmtNum(a.amountApplied)}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-xs max-w-[160px] truncate">{p.notes ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString() : "—"}</td>
                  <td className="px-3 py-2 text-xs">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-xs">
                    {p.chequeImageUrl && <a href={p.chequeImageUrl} target="_blank" rel="noreferrer" className="text-primary underline mr-2 text-[10px]">Cheque</a>}
                    {p.receiptUrl && <a href={p.receiptUrl} target="_blank" rel="noreferrer" className="text-primary underline text-[10px]">Receipt</a>}
                    {!p.chequeImageUrl && !p.receiptUrl && "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditPayment(p)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600"
                        onClick={() => { if (confirm("Delete this payment?")) deleteMutation.mutate({ id: p.id }); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <PaymentDialog
          open={addOpen || editPayment != null}
          editPayment={editPayment ?? undefined}
          onClose={() => { setAddOpen(false); setEditPayment(null); }}
          onSuccess={() => qc.invalidateQueries({ queryKey: getListPaymentsQueryKey() })}
        />
      </div>
    </PermissionGuard>
  );
}

function PaymentDialog({ open, editPayment, onClose, onSuccess }: {
  open: boolean;
  editPayment?: PaymentDetail;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { data: billings } = useListBillings({});
  const { data: payments } = useListPayments();
  const chequeRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const isEdit = editPayment != null;
  const form = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      mode: (editPayment?.mode as any) ?? "cash",
      notes: editPayment?.notes ?? "",
      chequeImageUrl: editPayment?.chequeImageUrl ?? "",
      receiptUrl: editPayment?.receiptUrl ?? "",
      paymentDate: editPayment?.paymentDate ?? "",
      allocations: editPayment?.allocations.map(a => ({ billingId: a.billingId, amountApplied: a.amountApplied })) ?? [],
    },
  });

  const mode = form.watch("mode");
  const allocations = form.watch("allocations");

  // Sum of amounts already allocated to each billing across all OTHER payments
  // (excluding the payment currently being edited, so its own allocations don't
  // count against itself and reduce the pending amount shown to the user).
  const allocatedElsewhereByBilling = new Map<number, number>();
  for (const pmt of payments ?? []) {
    if (isEdit && pmt.id === editPayment.id) continue;
    for (const a of pmt.allocations) {
      allocatedElsewhereByBilling.set(a.billingId, (allocatedElsewhereByBilling.get(a.billingId) ?? 0) + a.amountApplied);
    }
  }

  const settleableBillings = (billings ?? []).filter(b => b.status === "approved");

  // Map billingId -> pending (remaining receivable), used for both the row display
  // and to validate allocations don't exceed what's actually owed.
  const pendingByBilling = new Map<number, number>();
  for (const billing of settleableBillings) {
    pendingByBilling.set(billing.id, billing.netReceivable - (allocatedElsewhereByBilling.get(billing.id) ?? 0));
  }

  const toggleBilling = (billingId: number, pending: number) => {
    if (pending <= 0.01) return; // fully paid, can't be added
    const current = form.getValues("allocations");
    const exists = current.find(a => a.billingId === billingId);
    if (exists) {
      form.setValue("allocations", current.filter(a => a.billingId !== billingId));
    } else {
      form.setValue("allocations", [...current, { billingId, amountApplied: pending }]);
    }
  };

  const updateAllocation = (billingId: number, amount: number) => {
    const current = form.getValues("allocations");
    const pending = pendingByBilling.get(billingId);
    const clamped = pending != null ? Math.min(amount, pending) : amount;
    form.setValue("allocations", current.map(a => a.billingId === billingId ? { ...a, amountApplied: clamped } : a));
  };

  // Any allocation that (still) exceeds its billing's pending amount — should not
  // normally happen given the clamp in updateAllocation, but guards against stale
  // defaults (e.g. an edited payment whose original amount now exceeds pending).
  const overpaidAllocations = allocations.filter(a => {
    const pending = pendingByBilling.get(a.billingId);
    return pending != null && a.amountApplied > pending + 0.01;
  });
  const hasOverpay = overpaidAllocations.length > 0;

  const handleFileUpload = async (type: "cheque" | "receipt", file: File) => {
    setUploading(true);
    try {
      const url = await uploadFile(file);
      if (type === "cheque") form.setValue("chequeImageUrl", url);
      else form.setValue("receiptUrl", url);
      toast({ title: "File uploaded" });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const createMutation = useCreatePayment({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Payment recorded" }); },
      onError: () => toast({ title: "Failed to record payment", variant: "destructive" }),
    },
  });
  const updateMutation = useUpdatePayment({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Payment updated" }); },
      onError: () => toast({ title: "Failed to update payment", variant: "destructive" }),
    },
  });

  const onSubmit = (data: PaymentForm) => {
    const body = {
      mode: data.mode,
      notes: data.notes ?? null,
      chequeImageUrl: data.chequeImageUrl || null,
      receiptUrl: data.receiptUrl || null,
      paymentDate: data.paymentDate || null,
      allocations: data.allocations,
    };
    if (isEdit) {
      updateMutation.mutate({ id: editPayment.id, data: body });
    } else {
      createMutation.mutate({ data: body });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Payment" : "Record Payment"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="mode" render={({ field }) => (
              <FormItem><FormLabel>Payment Mode</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="online">Online Transfer</SelectItem>
                  </SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />

            {mode === "cheque" && (
              <FormItem>
                <FormLabel>Cheque Image</FormLabel>
                <div className="flex gap-2 items-center">
                  <Input type="file" accept="image/*,.pdf" ref={chequeRef}
                    onChange={e => e.target.files?.[0] && handleFileUpload("cheque", e.target.files[0])}
                    className="text-xs" disabled={uploading} />
                  {form.watch("chequeImageUrl") && (
                    <a href={form.watch("chequeImageUrl")} target="_blank" rel="noreferrer" className="text-xs text-primary underline whitespace-nowrap">View</a>
                  )}
                </div>
              </FormItem>
            )}

            {mode === "online" && (
              <FormItem>
                <FormLabel>Payment Receipt</FormLabel>
                <div className="flex gap-2 items-center">
                  <Input type="file" accept="image/*,.pdf" ref={receiptRef}
                    onChange={e => e.target.files?.[0] && handleFileUpload("receipt", e.target.files[0])}
                    className="text-xs" disabled={uploading} />
                  {form.watch("receiptUrl") && (
                    <a href={form.watch("receiptUrl")} target="_blank" rel="noreferrer" className="text-xs text-primary underline whitespace-nowrap">View</a>
                  )}
                </div>
              </FormItem>
            )}

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes</FormLabel>
                <FormControl><Textarea rows={2} placeholder="Optional notes..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="paymentDate" render={({ field }) => (
              <FormItem><FormLabel>Date Received</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div>
              <p className="text-sm font-medium mb-2">Billings to settle</p>
              <div className="border border-border rounded-lg divide-y divide-border max-h-56 overflow-y-auto">
                {settleableBillings.map(billing => {
                  const alloc = allocations.find(a => a.billingId === billing.id);
                  const pending = pendingByBilling.get(billing.id) ?? 0;
                  const fullyPaid = pending <= 0.01;
                  const label = billing.invoiceCode ?? `Billing #${billing.id}`;
                  const isOverpaid = !!alloc && alloc.amountApplied > pending + 0.01;
                  return (
                    <div key={billing.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={!!alloc} disabled={fullyPaid}
                            onChange={() => toggleBilling(billing.id, pending)}
                            className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50" />
                          <span className={cn("text-xs font-semibold", fullyPaid && "text-muted-foreground")}>{label}</span>
                          {fullyPaid ? (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                              Paid
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Pending: PKR {fmtNum(pending)}</span>
                          )}
                        </div>
                        {alloc && (
                          <Input
                            type="number"
                            step="0.01"
                            max={pending}
                            className={cn("w-32 h-6 text-xs", isOverpaid && "border-red-600 focus-visible:ring-red-600")}
                            value={alloc.amountApplied}
                            onChange={e => updateAllocation(billing.id, parseFloat(e.target.value) || 0)}
                          />
                        )}
                      </div>
                      {isOverpaid && (
                        <p className="text-[10px] text-red-600 mt-1">Amount exceeds pending for {label}</p>
                      )}
                    </div>
                  );
                })}
              </div>
              {form.formState.errors.allocations && (
                <p className="text-xs text-red-600 mt-1">{(form.formState.errors.allocations as any).message}</p>
              )}
              {allocations.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Total: PKR {fmtNum(allocations.reduce((s, a) => s + a.amountApplied, 0))}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isPending || uploading || hasOverpay}>
                {isPending ? "Saving..." : isEdit ? "Update" : "Record Payment"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
