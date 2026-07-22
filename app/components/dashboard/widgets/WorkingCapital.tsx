"use client";

import { useGetAging } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { formatMoney, DEFAULT_RATES } from "@/lib/analytics/currency";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

const sumBuckets = (b?: { "0-30": number; "31-60": number; "61-90": number; "90+": number }) =>
  b ? b["0-30"] + b["31-60"] + b["61-90"] + b["90+"] : 0;

export function WorkingCapital() {
  const { data: aging } = useGetAging();

  const rawRates = typeof window !== "undefined" ? localStorage.getItem("adops-exchange-rates") : null;
  const rates = rawRates ? JSON.parse(rawRates) : DEFAULT_RATES;
  const usdToPkr = rates.pkr ?? DEFAULT_RATES.pkr;

  // AR is already in PKR; AP is in USD → convert to PKR so the whole dashboard reads in PKR.
  const arPkr = sumBuckets(aging?.ar);
  const apPkr = sumBuckets(aging?.ap) * usdToPkr;
  const cashPosition = arPkr - apPkr;

  return (
    <DashboardWidget title="Working Capital">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Receivables</p>
          <p className="mt-0.5 text-base font-semibold text-emerald-600 dark:text-emerald-400">
            {formatMoney(arPkr, "PKR")}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Payables</p>
          <p className="mt-0.5 text-base font-semibold text-red-600 dark:text-red-400">
            {formatMoney(apPkr, "PKR")}
          </p>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-border">
        <p className="text-xs text-muted-foreground">Cash Position</p>
        <p className={cn(
          "mt-1 text-2xl font-bold tracking-tight",
          cashPosition >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
        )}>
          {formatMoney(cashPosition, "PKR")}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">Receivables − Payables</p>
      </div>
    </DashboardWidget>
  );
}
