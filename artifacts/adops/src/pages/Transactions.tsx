import { useState, useEffect } from "react";
import { Plus, Download } from "lucide-react";
import {
  useListAllBillingRecords, useCreateBillingRecord, useUpdateBillingRecord, useDeleteBillingRecord,
  useListBuyingHouses, useListClients, useListPlatforms,
  getListAllBillingRecordsQueryKey,
} from "@workspace/api-client-react";
import type { Platform, BuyingHouse } from "@workspace/api-client-react";
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
import { computeRow } from "@/lib/computeRow";
import { cn } from "@/lib/utils";

function getGlobalForexRate(): number {
  try {
    const rates = JSON.parse(localStorage.getItem("adops-exchange-rates") ?? "{}");
    return (rates["pkr"] as number) ?? 278;
  } catch { return 278; }
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

const addRecordSchema = z.object({
  platformId: z.number({ required_error: "Platform is required" }),
  buyingHouseId: z.number({ required_error: "Buying house is required" }),
  clientId: z.number().nullable().optional(),
  costModelId: z.number({ required_error: "Cost model is required" }),
  period: z.string().min(1, "Period is required"),
  appsflyerPins: z.number().int().min(0),
  fraudPins: z.number().int().min(0),
  payoutRate: z.number().min(0),
  marginPct: z.number().min(0).max(100),
  forexSellingRate: z.number().min(0),
  forexBuyingRate: z.number().min(0),
  salesTaxPct: z.number().min(0),
  remittanceTaxPct: z.number().min(0),
  withholdingTaxPct: z.number().min(0),
  bulkDiscountPct: z.number().min(0),
  platformBulkDiscountPct: z.number().min(0),
});
type AddRecordForm = z.infer<typeof addRecordSchema>;

export default function BillingPage() {
  const [periodFilter, setPeriodFilter] = useState("");
  const [bhFilter, setBhFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<typeof computed[0] | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const params = {
    ...(periodFilter ? { period: periodFilter } : {}),
    ...(bhFilter !== "all" ? { buyingHouseId: parseInt(bhFilter) } : {}),
    ...(clientFilter !== "all" ? { clientId: parseInt(clientFilter) } : {}),
    ...(platformFilter !== "all" ? { platformId: parseInt(platformFilter) } : {}),
  };

  const { data: records, isLoading } = useListAllBillingRecords(params);
  const { data: buyingHouses } = useListBuyingHouses();
  const { data: clients } = useListClients();
  const { data: platforms } = useListPlatforms();

  const deleteMutation = useDeleteBillingRecord({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListAllBillingRecordsQueryKey() }); toast({ title: "Record deleted" }); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  // BillingRecord has no platformName — build a lookup map from platforms list
  const platformNameMap = Object.fromEntries((platforms ?? []).map(p => [p.id, p.name]));

  const computed = (records ?? []).map(r => ({
    ...r,
    platformName: platformNameMap[r.platformId] ?? null,
    ...computeRow({
      appsflyerPins: r.appsflyerPins,
      fraudPins: r.fraudPins,
      payoutRate: r.payoutRate,
      marginPct: r.marginPct,
      forexSellingRate: r.forexSellingRate ?? 0,
      forexBuyingRate: r.forexBuyingRate ?? 0,
      salesTaxPct: r.salesTaxPct,
      remittanceTaxPct: r.remittanceTaxPct,
      withholdingTaxPct: r.withholdingTaxPct,
      bulkDiscountPct: r.bulkDiscountPct ?? 0,
      platformBulkDiscountPct: r.platformBulkDiscountPct ?? 0,
    }),
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
    bulkDiscountAmt: acc.bulkDiscountAmt + r.bulkDiscountAmt,
    amtAfterDiscount: acc.amtAfterDiscount + r.amtAfterDiscount,
    wht: acc.wht + r.wht,
    receivablePkr: acc.receivablePkr + r.receivablePkr,
    netPayableUsd: acc.netPayableUsd + r.netPayableUsd,
    remittanceTax: acc.remittanceTax + r.remittanceTax,
    totalPayableUsd: acc.totalPayableUsd + r.totalPayableUsd,
    platformDiscountAmt: acc.platformDiscountAmt + r.platformDiscountAmt,
    totalPayablePkr: acc.totalPayablePkr + r.totalPayablePkr,
    netMarginPkr: acc.netMarginPkr + r.netMarginPkr,
  }), {
    appsflyerPins: 0, fraudPins: 0, actualPins: 0, netAmtUsd: 0, netAmtPkr: 0,
    grossAmtPkr: 0, salesTax: 0, totalAmtPkr: 0, bulkDiscountAmt: 0, amtAfterDiscount: 0,
    wht: 0, receivablePkr: 0, netPayableUsd: 0, remittanceTax: 0, totalPayableUsd: 0,
    platformDiscountAmt: 0, totalPayablePkr: 0, netMarginPkr: 0,
  });

  const exportCSV = () => {
    if (!computed.length) return;
    const headers = ["S#","Client","Via (BH)","Platform","Period","MMP Pins","Fraud Pins","Actual Pins","Payout Rate","Net Amt (USD)","Forex Sell","Net Amt (PKR)","Gross Amt (PKR)","Sales Tax","Total Amt (PKR)","BH Discount","After Discount","WHT","Receivable (PKR)","Net Payable (USD)","Remittance Tax","Total Payable (USD)","Forex Buy","Platform Discount","Total Payable (PKR)","Net Margin (PKR)","Logged By","Logged At"];
    const rows = computed.map((r, i) => [i+1,r.clientName??"",r.buyingHouseName??"",r.platformName??"",r.period,r.appsflyerPins,r.fraudPins,r.actualPins,r.payoutRate.toFixed(4),r.netAmtUsd.toFixed(2),r.forexSellingRate ?? 0,r.netAmtPkr.toFixed(2),r.grossAmtPkr.toFixed(2),r.salesTax.toFixed(2),r.totalAmtPkr.toFixed(2),r.bulkDiscountAmt.toFixed(2),r.amtAfterDiscount.toFixed(2),r.wht.toFixed(2),r.receivablePkr.toFixed(2),r.netPayableUsd.toFixed(2),r.remittanceTax.toFixed(2),r.totalPayableUsd.toFixed(2),r.forexBuyingRate ?? 0,r.platformDiscountAmt.toFixed(2),r.totalPayablePkr.toFixed(2),r.netMarginPkr.toFixed(2),r.createdBy??"",`"${new Date(r.createdAt).toLocaleString()}"`]);
    const csv = [headers,...rows].map(r=>r.join(",")).join("\n");
    const blob = new Blob([csv],{type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`billing-all.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Transactions</h1>
          <p className="text-sm text-muted-foreground">{records?.length ?? 0} records</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <Input type="month" className="w-40 text-sm" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} />
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-40 text-sm"><SelectValue placeholder="All platforms" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {platforms?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={bhFilter} onValueChange={setBhFilter}>
          <SelectTrigger className="w-44 text-sm"><SelectValue placeholder="All buying houses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All buying houses</SelectItem>
            {buyingHouses?.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}
          </SelectContent>
        </Select>
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
          {hasPermission("View Transactions") && (
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
              <TH>S#</TH><TH>Client</TH><TH>Via (BH)</TH><TH>Platform</TH><TH>Period</TH>
              <TH>MMP Pins</TH><TH>Fraud Pins</TH><TH>Actual Pins</TH>
              <TH>Payout Rate</TH><TH>Net Amt (USD)</TH><TH>Forex Sell</TH><TH>Net Amt (PKR)</TH>
              <TH>Gross Amt (PKR)</TH><TH>Sales Tax</TH><TH>Total Amt (PKR)</TH>
              <TH>BH Discount</TH><TH>After Discount</TH><TH>WHT</TH><TH>Receivable (PKR)</TH>
              <TH>Net Payable (USD)</TH><TH>Remittance Tax</TH><TH>Total Payable (USD)</TH>
              <TH>Forex Buy</TH><TH>Platform Discount</TH><TH>Total Payable (PKR)</TH>
              <TH>Net Margin (PKR)</TH><TH>Logged By</TH><TH>Logged At</TH><TH>Actions</TH>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(30)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                </tr>
              ))
            ) : computed.length === 0 ? (
              <tr><td colSpan={30} className="px-5 py-10 text-center text-sm text-muted-foreground">No billing records</td></tr>
            ) : (
              <>
                {computed.map((r, i) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <TD>{i + 1}</TD>
                    <TD bold>{r.clientName ?? "—"}</TD>
                    <TD>{r.buyingHouseName ?? "—"}</TD>
                    <TD>{r.platformName ?? "—"}</TD>
                    <TD bold>{r.period}</TD>
                    <TD>{r.appsflyerPins.toLocaleString()}</TD>
                    <TD>{r.fraudPins.toLocaleString()}</TD>
                    <TD bold>{r.actualPins.toLocaleString()}</TD>
                    <TD>{fmtNum(r.payoutRate, 4)}</TD>
                    <TD>{fmtNum(r.netAmtUsd)}</TD>
                    <TD>{fmtNum(r.forexSellingRate, 4)}</TD>
                    <TD>{fmtNum(r.netAmtPkr)}</TD>
                    <TD>{fmtNum(r.grossAmtPkr)}</TD>
                    <TD>{fmtNum(r.salesTax)}</TD>
                    <TD>{fmtNum(r.totalAmtPkr)}</TD>
                    <TD>{fmtNum(r.bulkDiscountAmt)}</TD>
                    <TD>{fmtNum(r.amtAfterDiscount)}</TD>
                    <TD>{fmtNum(r.wht)}</TD>
                    <TD bold className={r.receivablePkr < 0 ? "text-red-600" : ""}>{fmtNum(r.receivablePkr)}</TD>
                    <TD>{fmtNum(r.netPayableUsd)}</TD>
                    <TD>{fmtNum(r.remittanceTax)}</TD>
                    <TD>{fmtNum(r.totalPayableUsd)}</TD>
                    <TD>{fmtNum(r.forexBuyingRate, 4)}</TD>
                    <TD>{fmtNum(r.platformDiscountAmt)}</TD>
                    <TD>{fmtNum(r.totalPayablePkr)}</TD>
                    <TD bold className={r.netMarginPkr < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                      {fmtNum(r.netMarginPkr)}
                    </TD>
                    <TD>{r.createdBy ?? "—"}</TD>
                    <TD>{new Date(r.createdAt).toLocaleDateString()} {new Date(r.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</TD>
                    <TD>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs"
                          onClick={() => { setEditRecord(r); setEditOpen(true); }}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-red-600"
                          onClick={() => { if (confirm("Delete this record?")) deleteMutation.mutate({ id: r.platformId, recordId: r.id }); }}>
                          Del
                        </Button>
                      </div>
                    </TD>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-muted/30">
                  <TD bold></TD><TD bold>Total</TD><TD></TD><TD></TD><TD></TD>
                  <TD bold>{totals.appsflyerPins.toLocaleString()}</TD>
                  <TD bold>{totals.fraudPins.toLocaleString()}</TD>
                  <TD bold>{totals.actualPins.toLocaleString()}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.netAmtUsd)}</TD><TD></TD>
                  <TD bold>{fmtNum(totals.netAmtPkr)}</TD>
                  <TD bold>{fmtNum(totals.grossAmtPkr)}</TD>
                  <TD bold>{fmtNum(totals.salesTax)}</TD>
                  <TD bold>{fmtNum(totals.totalAmtPkr)}</TD>
                  <TD bold>{fmtNum(totals.bulkDiscountAmt)}</TD>
                  <TD bold>{fmtNum(totals.amtAfterDiscount)}</TD>
                  <TD bold>{fmtNum(totals.wht)}</TD>
                  <TD bold>{fmtNum(totals.receivablePkr)}</TD>
                  <TD bold>{fmtNum(totals.netPayableUsd)}</TD>
                  <TD bold>{fmtNum(totals.remittanceTax)}</TD>
                  <TD bold>{fmtNum(totals.totalPayableUsd)}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.platformDiscountAmt)}</TD>
                  <TD bold>{fmtNum(totals.totalPayablePkr)}</TD>
                  <TD bold className={totals.netMarginPkr < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                    {fmtNum(totals.netMarginPkr)}
                  </TD>
                  <TD></TD><TD></TD><TD></TD>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <AddRecordDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        platforms={platforms ?? []}
        buyingHouses={buyingHouses ?? []}
        clients={clients ?? []}
        onSuccess={() => qc.invalidateQueries({ queryKey: getListAllBillingRecordsQueryKey() })}
      />

      {editRecord && (
        <AddRecordDialog
          open={editOpen}
          onClose={() => { setEditOpen(false); setEditRecord(null); }}
          platforms={platforms ?? []}
          buyingHouses={buyingHouses ?? []}
          clients={clients ?? []}
          defaultValues={editRecord}
          recordId={editRecord.id}
          onSuccess={() => qc.invalidateQueries({ queryKey: getListAllBillingRecordsQueryKey() })}
        />
      )}
    </div>
  );
}

function AddRecordDialog({ open, onClose, platforms, buyingHouses, clients, onSuccess, defaultValues, recordId }: {
  open: boolean; onClose: () => void;
  platforms: Platform[]; buyingHouses: BuyingHouse[];
  clients: Array<{ id: number; name: string; buyingHouseId?: number | null }>;
  onSuccess: () => void;
  defaultValues?: {
    platformId: number; buyingHouseId: number; clientId?: number | null;
    costModelId: number; period: string; appsflyerPins: number; fraudPins: number;
    payoutRate: number; marginPct: number;
    forexSellingRate?: number | null; forexBuyingRate?: number | null;
    salesTaxPct: number; remittanceTaxPct: number; withholdingTaxPct: number;
    bulkDiscountPct?: number | null; platformBulkDiscountPct?: number | null;
  } | null;
  recordId?: number;
}) {
  const { toast } = useToast();
  const isEdit = recordId != null;
  const form = useForm<AddRecordForm>({ resolver: zodResolver(addRecordSchema) });

  useEffect(() => {
    if (open && defaultValues) {
      form.reset({
        platformId: defaultValues.platformId,
        buyingHouseId: defaultValues.buyingHouseId,
        clientId: defaultValues.clientId ?? null,
        costModelId: defaultValues.costModelId,
        period: defaultValues.period,
        appsflyerPins: defaultValues.appsflyerPins,
        fraudPins: defaultValues.fraudPins,
        payoutRate: defaultValues.payoutRate,
        marginPct: defaultValues.marginPct,
        forexSellingRate: defaultValues.forexSellingRate ?? 0,
        forexBuyingRate: defaultValues.forexBuyingRate ?? 0,
        salesTaxPct: defaultValues.salesTaxPct,
        remittanceTaxPct: defaultValues.remittanceTaxPct,
        withholdingTaxPct: defaultValues.withholdingTaxPct,
        bulkDiscountPct: defaultValues.bulkDiscountPct ?? 0,
        platformBulkDiscountPct: defaultValues.platformBulkDiscountPct ?? 0,
      } as AddRecordForm);
    }
  }, [open, defaultValues]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPlatformId = form.watch("platformId");
  const selectedBHId = form.watch("buyingHouseId");
  const selectedPlatform = platforms.find(p => p.id === selectedPlatformId);
  const selectedBH = buyingHouses.find(bh => bh.id === selectedBHId);
  const filteredClients = clients.filter(c => c.buyingHouseId === selectedBHId || !selectedBHId);

  useEffect(() => {
    if (selectedBH) {
      if (selectedBH.salesTaxPct != null) form.setValue("salesTaxPct", selectedBH.salesTaxPct);
      if (selectedBH.withholdingTaxPct != null) form.setValue("withholdingTaxPct", selectedBH.withholdingTaxPct);
      if (selectedBH.remittanceTaxPct != null) form.setValue("remittanceTaxPct", selectedBH.remittanceTaxPct);
      form.setValue("bulkDiscountPct", selectedBH.bulkDiscountPct ?? 0);
    }
  }, [selectedBHId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedPlatform) {
      form.setValue("platformBulkDiscountPct", selectedPlatform.bulkDiscountPct ?? 0);
    }
  }, [selectedPlatformId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) {
      const globalRate = getGlobalForexRate();
      if (!form.getValues("forexSellingRate")) form.setValue("forexSellingRate", globalRate);
      if (!form.getValues("forexBuyingRate")) form.setValue("forexBuyingRate", globalRate);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCostModelId = form.watch("costModelId");
  const costModels = selectedPlatform?.costModels ?? [];
  useEffect(() => {
    const cm = costModels.find(c => c.id === selectedCostModelId);
    if (cm) { form.setValue("payoutRate", cm.payoutRate); form.setValue("marginPct", cm.marginPct); }
  }, [selectedCostModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useCreateBillingRecord({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Billing record added" }); },
      onError: () => toast({ title: "Failed to add record", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateBillingRecord({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Billing record updated" }); },
      onError: () => toast({ title: "Failed to update record", variant: "destructive" }),
    },
  });

  const onSubmit = (data: AddRecordForm) => {
    const payload = {
      buyingHouseId: data.buyingHouseId,
      clientId: data.clientId ?? null,
      costModelId: data.costModelId,
      period: data.period,
      appsflyerPins: data.appsflyerPins,
      fraudPins: data.fraudPins,
      payoutRate: data.payoutRate,
      marginPct: data.marginPct,
      forexSellingRate: data.forexSellingRate,
      forexBuyingRate: data.forexBuyingRate,
      salesTaxPct: data.salesTaxPct,
      remittanceTaxPct: data.remittanceTaxPct,
      withholdingTaxPct: data.withholdingTaxPct,
      bulkDiscountPct: data.bulkDiscountPct,
      platformBulkDiscountPct: data.platformBulkDiscountPct,
    };

    if (isEdit) {
      updateMutation.mutate({ id: data.platformId, recordId: recordId!, data: payload });
    } else {
      createMutation.mutate({ id: data.platformId, data: payload });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Transaction" : "Add Transaction"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField control={form.control} name="platformId" render={({ field }) => (
              <FormItem><FormLabel>Platform</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select platform" /></SelectTrigger></FormControl>
                  <SelectContent>{platforms.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="costModelId" render={({ field }) => (
              <FormItem><FormLabel>Cost Model</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""} disabled={!selectedPlatformId}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select cost model" /></SelectTrigger></FormControl>
                  <SelectContent>{costModels.map(cm => <SelectItem key={cm.id} value={String(cm.id)}>{cm.name} (${cm.payoutRate}/pin · {cm.marginPct}%)</SelectItem>)}</SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="buyingHouseId" render={({ field }) => (
              <FormItem><FormLabel>Buying House</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select buying house" /></SelectTrigger></FormControl>
                  <SelectContent>{buyingHouses.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}</SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="clientId" render={({ field }) => (
              <FormItem><FormLabel>Client <span className="text-muted-foreground">(optional)</span></FormLabel>
                <Select onValueChange={v => field.onChange(v === "none" ? null : parseInt(v))} value={field.value != null ? String(field.value) : "none"}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {filteredClients.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="period" render={({ field }) => (
              <FormItem><FormLabel>Period</FormLabel><FormControl><Input type="month" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="appsflyerPins" render={({ field }) => (
                <FormItem><FormLabel>MMP Pins</FormLabel><FormControl><Input type="number" min={0} {...field} onChange={e => field.onChange(parseInt(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="fraudPins" render={({ field }) => (
                <FormItem><FormLabel>Fraud Pins</FormLabel><FormControl><Input type="number" min={0} {...field} onChange={e => field.onChange(parseInt(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="payoutRate" render={({ field }) => (
                <FormItem><FormLabel>Payout Rate (USD/pin)</FormLabel><FormControl><Input type="number" step="0.0001" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="marginPct" render={({ field }) => (
                <FormItem><FormLabel>Margin %</FormLabel><FormControl><Input type="number" step="0.01" min={0} max={100} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="forexSellingRate" render={({ field }) => (
                <FormItem><FormLabel>Forex Selling Rate (PKR)</FormLabel><FormControl><Input type="number" step="0.0001" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="forexBuyingRate" render={({ field }) => (
                <FormItem><FormLabel>Forex Buying Rate (PKR)</FormLabel><FormControl><Input type="number" step="0.0001" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FormField control={form.control} name="salesTaxPct" render={({ field }) => (
                <FormItem><FormLabel>Sales Tax %</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="remittanceTaxPct" render={({ field }) => (
                <FormItem><FormLabel>Remittance Tax %</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="withholdingTaxPct" render={({ field }) => (
                <FormItem><FormLabel>WHT %</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="bulkDiscountPct" render={({ field }) => (
                <FormItem><FormLabel>BH Bulk Discount %</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="platformBulkDiscountPct" render={({ field }) => (
                <FormItem><FormLabel>Platform Discount %</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {isEdit
                  ? (updateMutation.isPending ? "Saving..." : "Save")
                  : (createMutation.isPending ? "Adding..." : "Add")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
