"use client";

import { useGetAging } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { formatMoney, convertTo, DEFAULT_RATES } from "@/lib/analytics/currency";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

const sumBuckets = (b?: { "0-30": number; "31-60": number; "61-90": number; "90+": number }) =>
  b ? b["0-30"] + b["31-60"] + b["61-90"] + b["90+"] : 0;

export function WorkingCapital() {
  const { data: aging } = useGetAging();

  const baseCurrency = typeof window !== "undefined" ? (localStorage.getItem("adops-base-currency") || "USD") : "USD";
  const rawRates = typeof window !== "undefined" ? localStorage.getItem("adops-exchange-rates") : null;
  const exchangeRates = rawRates ? JSON.parse(rawRates) : DEFAULT_RATES;

  const arTotalBase = convertTo(sumBuckets(aging?.ar), "PKR", exchangeRates);
  const apTotalBase = convertTo(sumBuckets(aging?.ap), "USD", exchangeRates);
  const cashPosition = arTotalBase - apTotalBase;

  return (
    <DashboardWidget title="Working Capital">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Receivables</p>
          <p className="mt-0.5 text-base font-semibold text-emerald-600 dark:text-emerald-400">
            {formatMoney(arTotalBase, baseCurrency)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Payables</p>
          <p className="mt-0.5 text-base font-semibold text-red-600 dark:text-red-400">
            {formatMoney(apTotalBase, baseCurrency)}
          </p>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-border">
        <p className="text-xs text-muted-foreground">Cash Position</p>
        <p className={cn(
          "mt-1 text-2xl font-bold tracking-tight",
          cashPosition >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
        )}>
          {formatMoney(cashPosition, baseCurrency)}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">Receivables − Payables</p>
      </div>
    </DashboardWidget>
  );
}
