"use client";

import { useListAllBillingRecords, useListPartners } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { computeRow } from "@/lib/compute-row";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

function fmtPkr(n: number) {
  return "PKR " + n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function RecentTransactions() {
  const { data: records, isLoading: recordsLoading } = useListAllBillingRecords({} as never);
  const { data: platforms } = useListPartners();

  const platformNameMap = Object.fromEntries((platforms ?? []).map(p => [p.id, p.name]));

  const computed = (records ?? []).map(r => ({
    ...r,
    platformName: platformNameMap[r.platformId] ?? null,
    ...computeRow({
      appsflyerPins: r.appsflyerPins,
      fraudPins: r.fraudPins,
      payoutRate: String(r.payoutRate ?? 0),
      marginPct: String(r.marginPct ?? 0),
      forexSellingRate: String(r.forexSellingRate ?? 0),
      forexBuyingRate: String(r.forexBuyingRate ?? 0),
      salesTaxPct: String(r.salesTaxPct ?? 0),
      remittanceTaxPct: String(r.remittanceTaxPct ?? 0),
      withholdingTaxPct: String(r.withholdingTaxPct ?? 0),
      bulkDiscountPct: String(r.bulkDiscountPct ?? 0),
      platformBulkDiscountPct: String(r.platformBulkDiscountPct ?? 0),
    }),
  }));

  const recent = [...computed]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  return (
    <DashboardWidget title="Recent Billing Records">
      <div className="flex-1 overflow-x-auto min-h-0">
        <table className="w-full">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b border-border">
              {["Client", "Partner", "Period", "Receivable", "Margin"].map(h => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recordsLoading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {[...Array(5)].map((_, j) => (
                    <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>
                  ))}
                </tr>
              ))
            ) : recent.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-muted-foreground">No billing records yet. Upload data to get started.</td></tr>
            ) : (
              recent.map(r => {
                const marginPct = r.receivablePkr !== 0 ? (r.netMarginPkr / r.receivablePkr) * 100 : 0;
                const isNeg = r.netMarginPkr < 0;
                const isLow = !isNeg && marginPct < 10;
                return (
                  <tr key={r.id} className={cn(
                    "border-b border-border last:border-0 transition-colors hover:bg-muted/30",
                    isNeg && "bg-red-50/50 dark:bg-red-950/20",
                    isLow && "bg-amber-50/50 dark:bg-amber-950/20"
                  )}>
                    <td className="px-5 py-3 text-xs font-medium text-foreground">{r.clientName ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{r.platformName ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{r.period}</td>
                    <td className={cn("px-5 py-3 text-xs font-medium", r.receivablePkr < 0 && "text-red-600 dark:text-red-400")}>
                      {fmtPkr(r.receivablePkr)}
                    </td>
                    <td className="px-5 py-3 text-xs">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        isNeg ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                        isLow ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
                        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                      )}>
                        {marginPct.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </DashboardWidget>
  );
}
