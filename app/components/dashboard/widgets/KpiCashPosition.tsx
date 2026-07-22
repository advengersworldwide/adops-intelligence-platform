"use client";

import { Wallet } from "lucide-react";
import { useGetAging } from "@workspace/api-client-react";
import { KpiCard } from "@/components/analytics/KpiCard";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { formatMoney, convertTo, DEFAULT_RATES } from "@/lib/analytics/currency";

const sum = (b?: { "0-30": number; "31-60": number; "61-90": number; "90+": number }) =>
  b ? b["0-30"] + b["31-60"] + b["61-90"] + b["90+"] : 0;

export function KpiCashPosition() {
  const { data: aging, isLoading } = useGetAging();
  const baseCurrency = typeof window !== "undefined" ? localStorage.getItem("adops-base-currency") || "USD" : "USD";
  const rawRates = typeof window !== "undefined" ? localStorage.getItem("adops-exchange-rates") : null;
  const rates = rawRates ? JSON.parse(rawRates) : DEFAULT_RATES;
  const cash = convertTo(sum(aging?.ar), "PKR", rates) - convertTo(sum(aging?.ap), "USD", rates);
  return (
    <DashboardWidget fill={false}>
      <KpiCard title="Cash Position" value={formatMoney(cash, baseCurrency)} icon={<Wallet className="h-4 w-4" />} loading={isLoading} />
    </DashboardWidget>
  );
}
