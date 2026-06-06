import { useEffect, useState } from "react";
import { Plus, Trash2, Download } from "lucide-react";
import {
  useListBillingRecords, useCreateBillingRecord, useDeleteBillingRecord,
  getListBillingRecordsQueryKey, useListBuyingHouses,
} from "@workspace/api-client-react";
import type { Platform } from "@workspace/api-client-react";
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
import { hasPermission } from "@/lib/auth";
import { cn } from "@/lib/utils";

const addRecordSchema = z.object({
  buyingHouseId: z.number({ required_error: "Buying house is required" }),
  costModelId: z.number({ required_error: "Cost model is required" }),
  period: z.string().min(1, "Period is required"),
  appsflyerPins: z.number().int().min(0),
  fraudPins: z.number().int().min(0),
  payoutRate: z.number().min(0),
  marginPct: z.number().min(0).max(100),
  forexRate: z.number().min(0),
  salesTaxPct: z.number().min(0),
  remittanceTaxPct: z.number().min(0),
  withholdingTaxPct: z.number().min(0),
});
type AddRecordForm = z.infer<typeof addRecordSchema>;

function getForexRate(): number {
  try {
    const rates = JSON.parse(localStorage.getItem("adops-exchange-rates") ?? "{}");
    return (rates["pkr"] as number) ?? 278;
  } catch {
    return 278;
  }
}

function computeRow(
  appsflyerPins: number,
  fraudPins: number,
  payoutRate: number,
  marginPct: number,
  salesTaxPct: number,
  remittanceTaxPct: number,
  forexRate: number,
  withholdingTaxPct: number
) {
  const actualPins = appsflyerPins - fraudPins;
  const netAmtUsd = actualPins * payoutRate;
  const netAmtPkr = netAmtUsd * forexRate;
  const grossAmtPkr = marginPct > 0 ? netAmtPkr / (1 - marginPct / 100) : netAmtPkr;
  const salesTax = grossAmtPkr * (salesTaxPct / 100);
  const totalAmtPkr = grossAmtPkr + salesTax;
  const receivablePkr = totalAmtPkr - (totalAmtPkr * withholdingTaxPct / 100) - salesTax; // Total Amount - WHT - Sales Tax
  const netPayableUsd = netAmtUsd * (1 - marginPct / 100);
  const remittanceTax = netPayableUsd * (remittanceTaxPct / 100);
  const totalPayableUsd = netPayableUsd + remittanceTax;
  const totalPayablePkr = totalPayableUsd * forexRate;
  const netMarginPkr = receivablePkr - totalPayablePkr;
  return {
    actualPins, netAmtUsd, netAmtPkr, grossAmtPkr,
    salesTax, totalAmtPkr, receivablePkr,
    netPayableUsd, remittanceTax, totalPayableUsd, totalPayablePkr, netMarginPkr,
  };
}

function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

type TH = { children?: React.ReactNode };
const TH = ({ children }: TH) => (
  <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{children}</th>
);

type TD = { children?: React.ReactNode; bold?: boolean; className?: string };
const TD = ({ children, bold, className }: TD) => (
  <td className={cn("px-3 py-2 text-xs whitespace-nowrap", bold && "font-semibold", className)}>{children}</td>
);

export default function PlatformTransactionsTab({ platformId, platform }: { platformId: number; platform: Platform }) {
  const [periodFilter, setPeriodFilter] = useState("");
  const [buyingHouseFilter, setBuyingHouseFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const queryParams = {
    ...(periodFilter ? { period: periodFilter } : {}),
    ...(buyingHouseFilter !== "all" ? { buyingHouseId: parseInt(buyingHouseFilter) } : {}),
  };

  const { data: records, isLoading } = useListBillingRecords(platformId, queryParams);
  const { data: buyingHouses } = useListBuyingHouses();

  const deleteMutation = useDeleteBillingRecord({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListBillingRecordsQueryKey(platformId) });
        toast({ title: "Record deleted" });
      },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  // Platform's *current* tax rates — used only for column headers and pre-filling
  // the Add Record form. Per-row calculations use each record's frozen snapshot.
  const salesTaxPct = Number(platform.salesTaxPct ?? 0);
  const remittanceTaxPct = Number(platform.remittanceTaxPct ?? 0);

  const computed = (records ?? []).map(r => ({
    ...r,
    ...computeRow(
      r.appsflyerPins, r.fraudPins, r.payoutRate ?? 0,
      r.marginPct ?? 0, r.salesTaxPct ?? 0, r.remittanceTaxPct ?? 0,
      r.forexRate ?? 278, r.withholdingTaxPct ?? 0
    ),
  }));

  const totals = computed.reduce((acc, r) => ({
    appsflyerPins: acc.appsflyerPins + r.appsflyerPins,
    fraudPins: acc.fraudPins + r.fraudPins,
    actualPins: acc.actualPins + r.actualPins,
    netAmtUsd: acc.netAmtUsd + r.netAmtUsd,
    netAmtPkr: acc.netAmtPkr + r.netAmtPkr,
    grossAmtPkr: acc.grossAmtPkr + r.grossAmtPkr,
    salesTax: acc.salesTax + r.salesTax,
    totalAmtPkr: acc.totalAmtPkr + r.totalAmtPkr,
    receivablePkr: acc.receivablePkr + r.receivablePkr,
    netPayableUsd: acc.netPayableUsd + r.netPayableUsd,
    remittanceTax: acc.remittanceTax + r.remittanceTax,
    totalPayableUsd: acc.totalPayableUsd + r.totalPayableUsd,
    totalPayablePkr: acc.totalPayablePkr + r.totalPayablePkr,
    netMarginPkr: acc.netMarginPkr + r.netMarginPkr,
  }), { appsflyerPins: 0, fraudPins: 0, actualPins: 0, netAmtUsd: 0, netAmtPkr: 0, grossAmtPkr: 0, salesTax: 0, totalAmtPkr: 0, receivablePkr: 0, netPayableUsd: 0, remittanceTax: 0, totalPayableUsd: 0, totalPayablePkr: 0, netMarginPkr: 0 });

  const exportCSV = () => {
    if (!computed.length) return;
    const headers = ["S#","Buying House","Appsflyer Pins","Fraud Pins","Actual Pins","Payout Rate","Net Amount (USD)","Forex Rate","Net Amount (PKR)","Gross Amount (PKR)",`Sales Tax (${salesTaxPct}%)`,"Total Amount (PKR)","Receivable (PKR)","Net Payable (USD)",`Remittance Tax (${remittanceTaxPct}%)`,"Total Payable (USD)","Forex Rate","Total Payable (PKR)","Net Margin (PKR)","Logged By","Logged At"];
    const rows = computed.map((r, i) => [i+1,r.buyingHouseName??"",r.appsflyerPins,r.fraudPins,r.actualPins,r.payoutRate.toFixed(2),r.netAmtUsd.toFixed(2),r.forexRate,r.netAmtPkr.toFixed(2),r.grossAmtPkr.toFixed(2),r.salesTax.toFixed(2),r.totalAmtPkr.toFixed(2),r.receivablePkr.toFixed(2),r.netPayableUsd.toFixed(2),r.remittanceTax.toFixed(2),r.totalPayableUsd.toFixed(2),r.forexRate,r.totalPayablePkr.toFixed(2),r.netMarginPkr.toFixed(2),r.createdBy??"",`"${new Date(r.createdAt).toLocaleString()}"`]);
    const csv = [headers,...rows].map(r=>r.join(",")).join("\n");
    const blob = new Blob([csv],{type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url; a.download=`billing-${platform.name}-${periodFilter||"all"}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="month" className="w-40 text-sm" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} />
        <Select value={buyingHouseFilter} onValueChange={setBuyingHouseFilter}>
          <SelectTrigger className="w-44 text-sm"><SelectValue placeholder="All buying houses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All buying houses</SelectItem>
            {buyingHouses?.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={exportCSV}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
          {hasPermission("Edit Platforms") && (
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Record
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <TH>S#</TH><TH>Buying House</TH><TH>Appsflyer Pins</TH><TH>Fraud Pins</TH>
              <TH>Actual Pins</TH><TH>Payout Rate</TH><TH>Net Amount (USD)</TH><TH>Forex Rate</TH>
              <TH>Net Amount (PKR)</TH><TH>Gross Amount (PKR)</TH>
              <TH>Sales Tax ({fmtNum(salesTaxPct, 0)}%)</TH><TH>Total Amount (PKR)</TH>
              <TH>Receivable (PKR)</TH><TH>Net Payable (USD)</TH>
              <TH>Remittance Tax ({fmtNum(remittanceTaxPct, 0)}%)</TH>
              <TH>Total Payable (USD)</TH><TH>Forex Rate</TH><TH>Total Payable (PKR)</TH>
              <TH>Net Margin (PKR)</TH>
              <TH>Logged By</TH><TH>Logged At</TH>
              {hasPermission("Edit Platforms") && <TH></TH>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(22)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                </tr>
              ))
            ) : computed.length === 0 ? (
              <tr><td colSpan={22} className="px-5 py-10 text-center text-sm text-muted-foreground">No billing records</td></tr>
            ) : (
              <>
                {computed.map((r, i) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <TD>{i + 1}</TD>
                    <TD bold>{r.buyingHouseName ?? "—"}</TD>
                    <TD>{r.appsflyerPins.toLocaleString()}</TD>
                    <TD>{r.fraudPins.toLocaleString()}</TD>
                    <TD bold>{r.actualPins.toLocaleString()}</TD>
                    <TD>{fmtNum(r.payoutRate)}</TD>
                    <TD>{fmtNum(r.netAmtUsd)}</TD>
                    <TD>{fmtNum(r.forexRate)}</TD>
                    <TD>{fmtNum(r.netAmtPkr)}</TD>
                    <TD>{fmtNum(r.grossAmtPkr)}</TD>
                    <TD>{fmtNum(r.salesTax)}</TD>
                    <TD>{fmtNum(r.totalAmtPkr)}</TD>
                    <TD>{fmtNum(r.receivablePkr)}</TD>
                    <TD>{fmtNum(r.netPayableUsd)}</TD>
                    <TD>{fmtNum(r.remittanceTax)}</TD>
                    <TD>{fmtNum(r.totalPayableUsd)}</TD>
                    <TD>{fmtNum(r.forexRate)}</TD>
                    <TD>{fmtNum(r.totalPayablePkr)}</TD>
                    <TD bold className={r.netMarginPkr < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                      {fmtNum(r.netMarginPkr)}
                    </TD>
                    <TD>{r.createdBy ?? "—"}</TD>
                    <TD>{new Date(r.createdAt).toLocaleDateString()} {new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</TD>
                    {hasPermission("Edit Platforms") && (
                      <TD>
                        <button onClick={() => deleteMutation.mutate({ id: platformId, recordId: r.id })} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </TD>
                    )}
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-muted/30">
                  <TD bold></TD><TD bold>Total</TD>
                  <TD bold>{totals.appsflyerPins.toLocaleString()}</TD>
                  <TD bold>{totals.fraudPins.toLocaleString()}</TD>
                  <TD bold>{totals.actualPins.toLocaleString()}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.netAmtUsd)}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.netAmtPkr)}</TD>
                  <TD bold>{fmtNum(totals.grossAmtPkr)}</TD>
                  <TD bold>{fmtNum(totals.salesTax)}</TD>
                  <TD bold>{fmtNum(totals.totalAmtPkr)}</TD>
                  <TD bold>{fmtNum(totals.receivablePkr)}</TD>
                  <TD bold>{fmtNum(totals.netPayableUsd)}</TD>
                  <TD bold>{fmtNum(totals.remittanceTax)}</TD>
                  <TD bold>{fmtNum(totals.totalPayableUsd)}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.totalPayablePkr)}</TD>
                  <TD bold className={totals.netMarginPkr < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                    {fmtNum(totals.netMarginPkr)}
                  </TD>
                  <TD></TD><TD></TD>
                  {hasPermission("Edit Platforms") && <TD></TD>}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <AddRecordDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        platformId={platformId}
        platform={platform}
        costModels={platform.costModels ?? []}
      />
    </div>
  );
}

function AddRecordDialog({ open, onClose, platformId, platform, costModels }: {
  open: boolean; onClose: () => void;
  platformId: number;
  platform: Platform;
  costModels: { id: number; name: string; payoutRate: number; marginPct: number }[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: buyingHouses } = useListBuyingHouses();

  const form = useForm<AddRecordForm>({ resolver: zodResolver(addRecordSchema) });

  // Pre-fill forex rate from Settings (localStorage) and snapshot the platform's
  // current tax rates into the form when the dialog opens.
  useEffect(() => {
    if (open) {
      form.setValue("forexRate", getForexRate());
      form.setValue("salesTaxPct", Number(platform.salesTaxPct ?? 0));
      form.setValue("remittanceTaxPct", Number(platform.remittanceTaxPct ?? 0));
      form.setValue("withholdingTaxPct", Number(platform.withholdingTaxPct ?? 0));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill payout rate + margin from the selected cost model.
  const selectedCostModelId = form.watch("costModelId");
  useEffect(() => {
    const cm = costModels.find(c => c.id === selectedCostModelId);
    if (cm) {
      form.setValue("payoutRate", cm.payoutRate);
      form.setValue("marginPct", cm.marginPct);
    }
  }, [selectedCostModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useCreateBillingRecord({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListBillingRecordsQueryKey(platformId) });
        onClose();
        form.reset();
        toast({ title: "Billing record added" });
      },
      onError: () => toast({ title: "Failed to add record", variant: "destructive" }),
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Billing Record</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(data => createMutation.mutate({ id: platformId, data }))} className="space-y-3">
            <FormField control={form.control} name="buyingHouseId" render={({ field }) => (
              <FormItem><FormLabel>Buying House</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select buying house" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {buyingHouses?.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}
                  </SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="costModelId" render={({ field }) => (
              <FormItem><FormLabel>Cost Model</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select cost model" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {costModels.map(cm => <SelectItem key={cm.id} value={String(cm.id)}>{cm.name} (${cm.payoutRate}/pin · {cm.marginPct}% margin)</SelectItem>)}
                  </SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="period" render={({ field }) => (
              <FormItem><FormLabel>Period</FormLabel><FormControl><Input type="month" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="appsflyerPins" render={({ field }) => (
                <FormItem><FormLabel>Appsflyer Pins</FormLabel><FormControl><Input type="number" min={0} {...field} onChange={e => field.onChange(parseInt(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="fraudPins" render={({ field }) => (
                <FormItem><FormLabel>Fraud Pins</FormLabel><FormControl><Input type="number" min={0} {...field} onChange={e => field.onChange(parseInt(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="payoutRate" render={({ field }) => (
                <FormItem><FormLabel>Payout Rate (USD/pin)</FormLabel><FormControl><Input type="number" step="0.0001" min={0} {...field} value={field.value ?? ""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="marginPct" render={({ field }) => (
                <FormItem><FormLabel>Margin %</FormLabel><FormControl><Input type="number" step="0.01" min={0} max={100} {...field} value={field.value ?? ""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="forexRate" render={({ field }) => (
              <FormItem><FormLabel>Forex Rate (PKR)</FormLabel><FormControl><Input type="number" step="0.0001" min={0} {...field} value={field.value ?? ""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-3 gap-3">
              <FormField control={form.control} name="salesTaxPct" render={({ field }) => (
                <FormItem><FormLabel>Sales Tax %</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} value={field.value ?? ""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="remittanceTaxPct" render={({ field }) => (
                <FormItem><FormLabel>Remittance Tax %</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} value={field.value ?? ""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="withholdingTaxPct" render={({ field }) => (
                <FormItem><FormLabel>Withholding Tax %</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} value={field.value ?? ""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? "Adding..." : "Add Record"}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
