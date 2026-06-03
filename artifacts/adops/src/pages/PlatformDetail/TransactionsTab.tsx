import { useState } from "react";
import { Plus, Trash2, Download } from "lucide-react";
import {
  useListBillingRecords, useCreateBillingRecord, useDeleteBillingRecord,
  getListBillingRecordsQueryKey, useListClients,
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
  clientId: z.number({ required_error: "Client is required" }),
  costModelId: z.number({ required_error: "Cost model is required" }),
  period: z.string().min(1, "Period is required"),
  appsflyerPins: z.number().int().min(0),
  fraudPins: z.number().int().min(0),
  marginPct: z.number().min(0).max(100),
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
  forexRate: number
) {
  const actualPins = appsflyerPins - fraudPins;
  const netAmtUsd = actualPins * payoutRate;
  const netAmtPkr = netAmtUsd * forexRate;
  const grossAmtPkr = marginPct > 0 ? netAmtPkr / (1 - marginPct / 100) : netAmtPkr;
  const salesTax = grossAmtPkr * (salesTaxPct / 100);
  const totalAmtPkr = grossAmtPkr + salesTax;
  const receivablePkr = grossAmtPkr; // formula placeholder — update when exact formula confirmed
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

function fmtNum(n: number, d = 2) {
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
  const [clientFilter, setClientFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const queryParams = {
    ...(periodFilter ? { period: periodFilter } : {}),
    ...(clientFilter !== "all" ? { clientId: parseInt(clientFilter) } : {}),
  };

  const { data: records, isLoading } = useListBillingRecords(platformId, queryParams);
  const { data: clients } = useListClients();

  const deleteMutation = useDeleteBillingRecord({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListBillingRecordsQueryKey(platformId) });
        toast({ title: "Record deleted" });
      },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  const forexRate = getForexRate();
  const salesTaxPct = Number(platform.salesTaxPct ?? 0);
  const remittanceTaxPct = Number(platform.remittanceTaxPct ?? 0);

  const computed = (records ?? []).map(r => ({
    ...r,
    ...computeRow(
      r.appsflyerPins, r.fraudPins, r.costModelPayoutRate ?? 0,
      r.marginPct,
      salesTaxPct, remittanceTaxPct, forexRate
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
    const headers = ["S#","Billing Entity","Appsflyer Pins","Fraud Pins","Actual Pins","Payout Rate","Net Amount (USD)","Forex Rate","Net Amount (PKR)","Gross Amount (PKR)",`Sales Tax (${salesTaxPct}%)`,"Total Amount (PKR)","Receivable (PKR)","Net Payable (USD)",`Remittance Tax (${remittanceTaxPct}%)`,"Total Payable (USD)","Forex Rate","Total Payable (PKR)","Net Margin (PKR)"];
    const rows = computed.map((r, i) => [i+1,r.clientName??"",r.appsflyerPins,r.fraudPins,r.actualPins,(r.costModelPayoutRate??0).toFixed(2),r.netAmtUsd.toFixed(2),forexRate,r.netAmtPkr.toFixed(2),r.grossAmtPkr.toFixed(2),r.salesTax.toFixed(2),r.totalAmtPkr.toFixed(2),r.receivablePkr.toFixed(2),r.netPayableUsd.toFixed(2),r.remittanceTax.toFixed(2),r.totalPayableUsd.toFixed(2),forexRate,r.totalPayablePkr.toFixed(2),r.netMarginPkr.toFixed(2)]);
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
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-40 text-sm"><SelectValue placeholder="All clients" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
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
              <TH>S#</TH><TH>Billing Entity</TH><TH>Appsflyer Pins</TH><TH>Fraud Pins</TH>
              <TH>Actual Pins</TH><TH>Payout Rate</TH><TH>Net Amount (USD)</TH><TH>Forex Rate</TH>
              <TH>Net Amount (PKR)</TH><TH>Gross Amount (PKR)</TH>
              <TH>Sales Tax ({fmtNum(salesTaxPct, 0)}%)</TH><TH>Total Amount (PKR)</TH>
              <TH>Receivable (PKR)</TH><TH>Net Payable (USD)</TH>
              <TH>Remittance Tax ({fmtNum(remittanceTaxPct, 0)}%)</TH>
              <TH>Total Payable (USD)</TH><TH>Forex Rate</TH><TH>Total Payable (PKR)</TH>
              <TH>Net Margin (PKR)</TH>
              {hasPermission("Edit Platforms") && <TH></TH>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(20)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                </tr>
              ))
            ) : computed.length === 0 ? (
              <tr><td colSpan={20} className="px-5 py-10 text-center text-sm text-muted-foreground">No billing records</td></tr>
            ) : (
              <>
                {computed.map((r, i) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <TD>{i + 1}</TD>
                    <TD bold>{r.clientName ?? "—"}</TD>
                    <TD>{r.appsflyerPins.toLocaleString()}</TD>
                    <TD>{r.fraudPins.toLocaleString()}</TD>
                    <TD bold>{r.actualPins.toLocaleString()}</TD>
                    <TD>{fmtNum(r.costModelPayoutRate ?? 0)}</TD>
                    <TD>{fmtNum(r.netAmtUsd)}</TD>
                    <TD>{fmtNum(forexRate)}</TD>
                    <TD>{fmtNum(r.netAmtPkr)}</TD>
                    <TD>{fmtNum(r.grossAmtPkr)}</TD>
                    <TD>{fmtNum(r.salesTax)}</TD>
                    <TD>{fmtNum(r.totalAmtPkr)}</TD>
                    <TD>{fmtNum(r.receivablePkr)}</TD>
                    <TD>{fmtNum(r.netPayableUsd)}</TD>
                    <TD>{fmtNum(r.remittanceTax)}</TD>
                    <TD>{fmtNum(r.totalPayableUsd)}</TD>
                    <TD>{fmtNum(forexRate)}</TD>
                    <TD>{fmtNum(r.totalPayablePkr)}</TD>
                    <TD bold className={r.netMarginPkr < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                      {fmtNum(r.netMarginPkr)}
                    </TD>
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
        costModels={platform.costModels ?? []}
      />
    </div>
  );
}

function AddRecordDialog({ open, onClose, platformId, costModels }: {
  open: boolean; onClose: () => void;
  platformId: number;
  costModels: { id: number; name: string; payoutRate: number }[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: clients } = useListClients();

  const form = useForm<AddRecordForm>({ resolver: zodResolver(addRecordSchema) });

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
            <FormField control={form.control} name="clientId" render={({ field }) => (
              <FormItem><FormLabel>Billing Entity</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="costModelId" render={({ field }) => (
              <FormItem><FormLabel>Cost Model</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select cost model" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {costModels.map(cm => <SelectItem key={cm.id} value={String(cm.id)}>{cm.name} (${cm.payoutRate}/pin)</SelectItem>)}
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
            <FormField control={form.control} name="marginPct" render={({ field }) => (
              <FormItem><FormLabel>Margin %</FormLabel><FormControl><Input type="number" step="0.01" min={0} max={100} {...field} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
            )} />
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
