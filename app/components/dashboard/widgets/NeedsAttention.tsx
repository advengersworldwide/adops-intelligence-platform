"use client";

import { useListTransactions } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/analytics/currency";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function NeedsAttention() {
  const { data: transactions, isLoading: txLoading } = useListTransactions({ limit: 50 } as never);
  const problemRows = (transactions ?? []).filter(tx => tx.profit < 0 || (tx.marginPct ?? 100) < 10);

  return (
    <DashboardWidget title="Needs attention">
      <div className="flex-1 overflow-x-auto min-h-0">
        <table className="w-full">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b border-border">
              {["Campaign", "Client", "Platform", "Spend", "Cost", "Profit", "Margin"].map(h => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txLoading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {[...Array(7)].map((_, j) => (
                    <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>
                  ))}
                </tr>
              ))
            ) : problemRows.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing needs attention</td></tr>
            ) : (
              problemRows.map(tx => {
                const isNeg = tx.profit < 0;
                const isLow = !isNeg && (tx.marginPct ?? 100) < 10;
                return (
                  <tr key={tx.id} className={cn(
                    "border-b border-border last:border-0 transition-colors hover:bg-muted/30",
                    isNeg && "bg-red-50/50 dark:bg-red-950/20",
                    isLow && "bg-amber-50/50 dark:bg-amber-950/20"
                  )}>
                    <td className="px-5 py-3 text-xs font-medium text-foreground">{tx.campaignName ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{tx.clientName ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{tx.platformName ?? "—"}</td>
                    <td className="px-5 py-3 text-xs font-medium">{formatMoney(tx.spend)}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{formatMoney(tx.cost)}</td>
                    <td className={cn("px-5 py-3 text-xs font-semibold", isNeg ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                      {formatMoney(tx.profit)}
                    </td>
                    <td className="px-5 py-3 text-xs">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        isNeg ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                        isLow ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
                        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                      )}>
                        {tx.marginPct != null ? `${tx.marginPct.toFixed(1)}%` : "—"}
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
