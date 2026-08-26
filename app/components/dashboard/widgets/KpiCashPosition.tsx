"use client";

import { Wallet } from "lucide-react";
import { useGetAging } from "@workspace/api-client-react";
import { KpiCard } from "@/components/analytics/KpiCard";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { formatMoney, DEFAULT_RATES } from "@/lib/analytics/currency";

const sum = (b?: { "0-30": number; "31-60": number; "61-90": number; "90+": number }) =>
  b ? b["0-30"] + b["31-60"] + b["61-90"] + b["90+"] : 0;

export function KpiCashPosition() {
  const { data: aging, isLoading } = useGetAging();
  const rawRates = typeof window !== "undefined" ? localStorage.getItem("adops-exchange-rates") : null;
  const rates = rawRates ? JSON.parse(rawRates) : DEFAULT_RATES;
  const usdToPkr = rates.pkr ?? DEFAULT_RATES.pkr;
  // AR is already in PKR; AP is in USD → convert to PKR so this matches the PKR KPIs.
  const cash = sum(aging?.ar) - sum(aging?.ap) * usdToPkr;
  return (
    <DashboardWidget fill={false}>
      <KpiCard flat title="Cash Position" value={formatMoney(cash, "PKR")} icon={<Wallet className="h-4 w-4" />} loading={isLoading} />
    </DashboardWidget>
  );
}
