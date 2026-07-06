"use client";

import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useListBillings, useGenerateBillingInvoice, getListBillingsQueryKey,
} from "@workspace/api-client-react";
import type { BillingSummary } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { computeBilling } from "@/lib/compute-billing";
import { cn } from "@/lib/utils";
import { PermissionGuard } from "@/components/PermissionGuard";
import { StatusSelect } from "@/components/billings/StatusSelect";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function BillingDetailPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const router = useRouter();
  const { data: billings, isLoading } = useListBillings({});

  const gen = useGenerateBillingInvoice({ mutation: {
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: getListBillingsQueryKey() });
      toast({ title: `Invoice ${data.invoiceCode} generated` });
      router.push(`/billings/${data.id}/invoice`);
    },
    onError: () => toast({ title: "Approve the billing before generating an invoice", variant: "destructive" }),
  }});

  return (
    <PermissionGuard permission="View Billing Detail">
      <div className="space-y-4">
        <div><h1 className="text-xl font-bold">Billing Detail</h1>
          <p className="text-sm text-muted-foreground">{billings?.length ?? 0} billings</p></div>

        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Client", "Partner", "Month", "Total Invoice", "Less WHT", "Less SST", "Less BD", "Net Receivable",
                  "Net Payable (PKR)", "Net Margin", "Status", "Invoice"].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border">{[...Array(12)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}</tr>
                ))
              ) : !billings?.length ? (
                <tr><td colSpan={12} className="px-5 py-10 text-center text-sm text-muted-foreground">No billings yet</td></tr>
              ) : billings.map(b => <DetailRows key={b.id} b={b}
                onInvoice={() => gen.mutate({ id: b.id })} />)}
            </tbody>
          </table>
        </div>
      </div>
    </PermissionGuard>
  );
}

function DetailRows({ b, onInvoice }: { b: BillingSummary; onInvoice: () => void }) {
  return (
    <>
      {b.lines.map((line, idx) => {
        const c = computeBilling({
          events: line.items.map(it => ({ eventCount: it.eventCount, billableRate: it.billableRate, payoutRate: it.payoutRate })),
          forexSellingRate: b.forexSellingRate, forexBuyingRate: b.forexBuyingRate,
          remittanceTaxPct: b.remittanceTaxPct, salesTaxPct: b.salesTaxPct,
          withholdingTaxPct: b.withholdingTaxPct, bulkDiscountPct: b.bulkDiscountPct, whtApplied: b.whtApplied,
        });
        return (
          <tr key={line.id} className="border-b border-border hover:bg-muted/20 text-xs">
            <td className="px-3 py-2 font-semibold">{idx === 0 ? b.clientName : ""}</td>
            <td className="px-3 py-2">{line.partnerName}</td>
            <td className="px-3 py-2">{b.period}</td>
            <td className="px-3 py-2 font-semibold">{fmt(c.totalInvoice)}</td>
            <td className="px-3 py-2 text-red-600">({fmt(c.lessWht)})</td>
            <td className="px-3 py-2 text-red-600">({fmt(c.lessSst)})</td>
            <td className="px-3 py-2 text-red-600">({fmt(c.lessBd)})</td>
            <td className="px-3 py-2 font-semibold">{fmt(c.netReceivable)}</td>
            <td className="px-3 py-2">{fmt(c.netPayablePkr)}</td>
            <td className={cn("px-3 py-2 font-semibold", c.netMargin < 0 ? "text-red-600" : "text-emerald-600")}>{fmt(c.netMargin)}</td>
            {idx === 0 && (
              <>
                <td className="px-3 py-2" rowSpan={b.lines.length}><StatusSelect billingId={b.id} status={b.status} /></td>
                <td className="px-3 py-2" rowSpan={b.lines.length}>
                  {b.invoiceCode ? (
                    <a href={`/billings/${b.id}/invoice`} className="text-primary underline text-[11px]">{b.invoiceCode}</a>
                  ) : (
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]"
                      disabled={b.status !== "approved"} onClick={onInvoice}>
                      <FileText className="h-3 w-3" /> Generate
                    </Button>
                  )}
                </td>
              </>
            )}
          </tr>
        );
      })}
    </>
  );
}
