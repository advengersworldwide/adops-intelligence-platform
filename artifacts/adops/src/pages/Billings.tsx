import { useState } from "react";
import { Plus, FileText, Trash2, Pencil, Download } from "lucide-react";
import {
  useListBills, useCreateBill, useUpdateBill, useDeleteBill,
  useListAllBillingRecords, useListClients, useListBuyingHouses,
  getListBillsQueryKey,
} from "@workspace/api-client-react";
import type { BillDetail, BillSummary } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { computeRow } from "@/lib/computeRow";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function statusBadge(status: string) {
  const variants: Record<string, string> = {
    outstanding: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    partial: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    paid: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", variants[status] ?? "bg-muted text-muted-foreground")}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function generateInvoicePdf(bill: BillDetail) {
  const doc = new jsPDF();
  doc.setFontSize(20);
  doc.text("INVOICE", 14, 22);
  doc.setFontSize(11);
  doc.text(`Bill #: ${bill.billNumber}`, 14, 32);
  doc.text(`Date: ${new Date(bill.createdAt).toLocaleDateString()}`, 14, 39);
  if (bill.clientName) doc.text(`Client: ${bill.clientName}`, 14, 46);
  if (bill.buyingHouseName) doc.text(`Via: ${bill.buyingHouseName}`, 14, 53);

  const rows = bill.transactions.map(t => {
    const c = computeRow({
      appsflyerPins: t.appsflyerPins, fraudPins: t.fraudPins,
      payoutRate: t.payoutRate, marginPct: t.marginPct,
      forexSellingRate: t.forexSellingRate, forexBuyingRate: t.forexBuyingRate,
      salesTaxPct: t.salesTaxPct, remittanceTaxPct: t.remittanceTaxPct,
      withholdingTaxPct: t.withholdingTaxPct, bulkDiscountPct: t.bulkDiscountPct,
      platformBulkDiscountPct: t.platformBulkDiscountPct,
    });
    return [
      t.period,
      t.appsflyerPins - t.fraudPins,
      t.payoutRate.toFixed(4),
      c.grossAmtPkr.toFixed(2),
      c.salesTax.toFixed(2),
      c.wht.toFixed(2),
      c.receivablePkr.toFixed(2),
    ];
  });

  autoTable(doc, {
    startY: 62,
    head: [["Period", "Actual Pins", "Rate", "Gross (PKR)", "Sales Tax", "WHT", "Receivable (PKR)"]],
    body: rows,
  });

  const finalY = (doc as any).lastAutoTable.finalY + 10;
  doc.setFontSize(11);
  doc.text(`Total Receivable: PKR ${fmtNum(bill.totalReceivable)}`, 14, finalY);
  doc.text(`Total Paid:       PKR ${fmtNum(bill.totalPaid)}`, 14, finalY + 7);
  doc.text(`Pending:          PKR ${fmtNum(bill.totalPending)}`, 14, finalY + 14);

  doc.save(`${bill.billNumber}.pdf`);
}

const billSchema = z.object({
  clientId: z.number().nullable().optional(),
  buyingHouseId: z.number().nullable().optional(),
  billingRecordIds: z.array(z.number()).min(1, "Select at least one transaction"),
  notes: z.string().optional(),
});
type BillForm = z.infer<typeof billSchema>;

export default function BillingsPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [editBill, setEditBill] = useState<BillSummary | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: bills, isLoading } = useListBills({});
  const deleteMutation = useDeleteBill({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListBillsQueryKey() }); toast({ title: "Bill deleted" }); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Billings</h1>
          <p className="text-sm text-muted-foreground">{bills?.length ?? 0} bills</p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Create Bill
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Bill #", "Client", "Via (BH)", "Transactions", "Receivable (PKR)", "Paid (PKR)", "Pending (PKR)", "Progress", "Status", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(10)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                </tr>
              ))
            ) : !bills?.length ? (
              <tr><td colSpan={10} className="px-5 py-10 text-center text-sm text-muted-foreground">No bills yet</td></tr>
            ) : bills.map(bill => {
              const pct = bill.totalReceivable > 0 ? Math.min(100, (bill.totalPaid / bill.totalReceivable) * 100) : 0;
              return (
                <tr key={bill.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2 text-xs font-semibold">{bill.billNumber}</td>
                  <td className="px-3 py-2 text-xs">{bill.clientName ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{bill.buyingHouseName ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-center">{bill.transactionCount}</td>
                  <td className="px-3 py-2 text-xs font-semibold">{fmtNum(bill.totalReceivable)}</td>
                  <td className="px-3 py-2 text-xs text-emerald-600">{fmtNum(bill.totalPaid)}</td>
                  <td className="px-3 py-2 text-xs text-red-600">{fmtNum(bill.totalPending)}</td>
                  <td className="px-3 py-2 min-w-[100px]">
                    <div className="flex items-center gap-2">
                      <Progress value={pct} className="h-1.5 flex-1" />
                      <span className="text-[10px] text-muted-foreground w-8 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">{statusBadge(bill.status)}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <InvoicePdfButton billId={bill.id} />
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditBill(bill)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600"
                        onClick={() => { if (confirm("Delete this bill?")) deleteMutation.mutate({ id: bill.id }); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <BillDialog
        open={addOpen || editBill != null}
        editBill={editBill ?? undefined}
        onClose={() => { setAddOpen(false); setEditBill(null); }}
        onSuccess={() => qc.invalidateQueries({ queryKey: getListBillsQueryKey() })}
      />
    </div>
  );
}

function InvoicePdfButton({ billId }: { billId: number }) {
  const [loading, setLoading] = useState(false);
  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bills/${billId}`);
      const detail: BillDetail = await res.json();
      generateInvoicePdf(detail);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleDownload} disabled={loading}>
      <FileText className="h-3 w-3" />
    </Button>
  );
}

function BillDialog({ open, editBill, onClose, onSuccess }: {
  open: boolean;
  editBill?: BillSummary;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { data: transactions } = useListAllBillingRecords({});
  const { data: clients } = useListClients();
  const { data: buyingHouses } = useListBuyingHouses();

  const form = useForm<BillForm>({
    resolver: zodResolver(billSchema),
    defaultValues: {
      clientId: editBill?.clientId ?? null,
      buyingHouseId: editBill?.buyingHouseId ?? null,
      billingRecordIds: [],
      notes: editBill?.notes ?? "",
    },
  });

  const createMutation = useCreateBill({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Bill created" }); },
      onError: () => toast({ title: "Failed to create bill", variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateBill({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Bill updated" }); },
      onError: () => toast({ title: "Failed to update bill", variant: "destructive" }),
    },
  });

  const isEdit = editBill != null;
  const pending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = (data: BillForm) => {
    const body = {
      clientId: data.clientId ?? null,
      buyingHouseId: data.buyingHouseId ?? null,
      billingRecordIds: data.billingRecordIds,
      notes: data.notes ?? null,
    };
    if (isEdit) {
      updateMutation.mutate({ id: editBill.id, data: body });
    } else {
      createMutation.mutate({ data: body });
    }
  };

  const selectedIds = form.watch("billingRecordIds");
  const toggleTx = (id: number) => {
    const current = form.getValues("billingRecordIds");
    form.setValue("billingRecordIds", current.includes(id) ? current.filter(i => i !== id) : [...current, id]);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Bill ${editBill?.billNumber}` : "Create Bill"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="clientId" render={({ field }) => (
                <FormItem><FormLabel>Client</FormLabel>
                  <Select onValueChange={v => field.onChange(v === "none" ? null : parseInt(v))} value={field.value != null ? String(field.value) : "none"}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="buyingHouseId" render={({ field }) => (
                <FormItem><FormLabel>Buying House</FormLabel>
                  <Select onValueChange={v => field.onChange(v === "none" ? null : parseInt(v))} value={field.value != null ? String(field.value) : "none"}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select BH" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {buyingHouses?.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}
                    </SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes</FormLabel>
                <FormControl><Textarea rows={2} placeholder="Optional notes..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div>
              <p className="text-sm font-medium mb-2">Select Transactions ({selectedIds.length} selected)</p>
              <div className="border border-border rounded-lg max-h-64 overflow-y-auto divide-y divide-border">
                {(transactions ?? []).map(t => {
                  const c = computeRow({
                    appsflyerPins: t.appsflyerPins, fraudPins: t.fraudPins,
                    payoutRate: t.payoutRate ?? 0, marginPct: t.marginPct ?? 0,
                    forexSellingRate: t.forexSellingRate ?? 0, forexBuyingRate: t.forexBuyingRate ?? 0,
                    salesTaxPct: t.salesTaxPct ?? 0, remittanceTaxPct: t.remittanceTaxPct ?? 0,
                    withholdingTaxPct: t.withholdingTaxPct ?? 0, bulkDiscountPct: t.bulkDiscountPct ?? 0,
                    platformBulkDiscountPct: t.platformBulkDiscountPct ?? 0,
                  });
                  const selected = selectedIds.includes(t.id);
                  return (
                    <div
                      key={t.id}
                      onClick={() => toggleTx(t.id)}
                      className={cn("flex items-center justify-between px-3 py-2 cursor-pointer text-xs hover:bg-muted/40", selected && "bg-primary/5")}
                    >
                      <div className="flex items-center gap-2">
                        <input type="checkbox" readOnly checked={selected} className="pointer-events-none" />
                        <span className="font-medium">{t.period}</span>
                        <span className="text-muted-foreground">{t.platformName ?? t.platformId}</span>
                        <span className="text-muted-foreground">{t.clientName ?? "—"}</span>
                      </div>
                      <span className="font-semibold">PKR {fmtNum(c.receivablePkr)}</span>
                    </div>
                  );
                })}
              </div>
              {form.formState.errors.billingRecordIds && (
                <p className="text-xs text-red-600 mt-1">{form.formState.errors.billingRecordIds.message}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Saving..." : isEdit ? "Update" : "Create Bill"}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
