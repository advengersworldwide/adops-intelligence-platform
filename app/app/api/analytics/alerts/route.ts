import { NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import {
  db, clientsTable, partnersTable,
  billingsTable, paymentBillingsTable, paymentsTable,
  partnerPurchaseOrdersTable, partnerBillsTable, billingRecordsTable,
} from "@workspace/db";
import { GetAlertsResponse } from "@workspace/api-zod";
import { billingNetReceivable } from "@/app/api/billings/route";
import { buildFraudSeries } from "@/lib/analytics/fraud";
import { formatMoney } from "@/lib/analytics/currency";
import { aggregateTotals, type AggRecord } from "@/lib/analytics/billing-records-agg";

import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

type AlertRow = {
  id: string;
  type: "negative_profit" | "low_margin" | "overdue_invoice" | "ppo_overspend" | "fraud_spike";
  severity: "warning" | "critical";
  message: string;
  campaignId: number | null;
  campaignName: string | null;
  label?: string | null;
  clientName?: string | null;
  platformName?: string | null;
  value: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const LOW_MARGIN_THRESHOLD = 10;

export async function GET(): Promise<Response> {
  const auth = await requirePermission("analytics:view");
  if (isAuthError(auth)) return auth;
  const recs = await db.select().from(billingRecordsTable);

  const clientIds = [...new Set(recs.map((r) => r.clientId).filter((id): id is number => id != null))];
  const platformIds = [...new Set(recs.map((r) => r.platformId))];

  const [clientRows, partnerRows] = await Promise.all([
    clientIds.length
      ? db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable).where(inArray(clientsTable.id, clientIds))
      : Promise.resolve([]),
    platformIds.length
      ? db.select({ id: partnersTable.id, name: partnersTable.name }).from(partnersTable).where(inArray(partnersTable.id, platformIds))
      : Promise.resolve([]),
  ]);
  const clientNameMap = new Map(clientRows.map((c) => [c.id, c.name]));
  const partnerNameMap = new Map(partnerRows.map((p) => [p.id, p.name]));

  const alerts: AlertRow[] = [];

  for (const r of recs) {
    const t = aggregateTotals([r as AggRecord]);
    const clientName = r.clientId != null ? (clientNameMap.get(r.clientId) ?? null) : null;
    const platformName = partnerNameMap.get(r.platformId) ?? null;
    const label = `${clientName ?? "Unknown client"} / ${platformName ?? "Unknown partner"} / ${r.period}`;
    if (t.profit < 0) {
      alerts.push({
        id: `neg-${r.id}`, type: "negative_profit", severity: "critical",
        message: `${label} has negative profit of ${formatMoney(Math.abs(t.profit), "PKR")}`,
        campaignId: null, campaignName: null, label, clientName, platformName, value: t.profit,
      });
    } else if (t.marginPct < LOW_MARGIN_THRESHOLD) {
      alerts.push({
        id: `low-${r.id}`, type: "low_margin", severity: "warning",
        message: `${label} has low margin of ${t.marginPct.toFixed(1)}%`,
        campaignId: null, campaignName: null, label, clientName, platformName, value: t.marginPct,
      });
    }
  }

  // overdue_invoice: outstanding = netReceivable - Σ received payments; flag when >60d old.
  const billings = await db.select().from(billingsTable);
  const now = Date.now();
  for (const b of billings) {
    const netReceivable = await billingNetReceivable(b.id);
    const paidRows = await db.select({ amt: paymentBillingsTable.amountApplied })
      .from(paymentBillingsTable)
      .innerJoin(paymentsTable, eq(paymentBillingsTable.paymentId, paymentsTable.id))
      .where(and(eq(paymentBillingsTable.billingId, b.id), eq(paymentsTable.status, "received")));
    const received = paidRows.reduce((s, r) => s + Number(r.amt), 0);
    const outstanding = netReceivable - received;
    const anchor = b.invoiceGeneratedAt ?? b.createdAt;
    const ageDays = Math.floor((now - anchor.getTime()) / DAY_MS);
    if (outstanding > 0 && ageDays > 60) {
      const label = b.invoiceCode ?? `Billing #${b.id}`;
      alerts.push({
        id: `overdue-${b.id}`, type: "overdue_invoice", severity: ageDays > 90 ? "critical" : "warning",
        message: `Invoice ${label} overdue ${ageDays}d, ${formatMoney(outstanding)} outstanding`,
        label, campaignId: null, campaignName: null, value: outstanding,
      });
    }
  }

  // ppo_overspend: consumed = Σ partnerBillsTable.amount for this PPO; flag when consumed > budget.
  const ppos = await db.select().from(partnerPurchaseOrdersTable);
  for (const ppo of ppos) {
    const budget = Number(ppo.totalBudget);
    const billRows = await db.select({ amt: partnerBillsTable.amount })
      .from(partnerBillsTable)
      .where(eq(partnerBillsTable.partnerPurchaseOrderId, ppo.id));
    const consumed = billRows.reduce((s, r) => s + Number(r.amt), 0);
    if (budget > 0 && consumed > budget) {
      alerts.push({
        id: `ppo-${ppo.id}`, type: "ppo_overspend", severity: "critical",
        message: `PPO ${ppo.code} overspent: ${formatMoney(consumed)} of ${formatMoney(budget)}`,
        label: ppo.code, campaignId: null, campaignName: null, value: consumed - budget,
      });
    }
  }

  // fraud_spike: aggregate billing records into fraud series by period; flag latest period if >10%.
  const fraudRows = await db.select({
    period: billingRecordsTable.period,
    appsflyerPins: billingRecordsTable.appsflyerPins,
    fraudPins: billingRecordsTable.fraudPins,
  }).from(billingRecordsTable);
  const fraudSeries = buildFraudSeries(fraudRows);
  const latest = fraudSeries[fraudSeries.length - 1];
  if (latest && latest.fraudRatePct > 10) {
    alerts.push({
      id: `fraud-${latest.period}`, type: "fraud_spike", severity: latest.fraudRatePct > 15 ? "critical" : "warning",
      message: `Fraud rate ${latest.fraudRatePct.toFixed(1)}% in ${latest.period}`,
      label: latest.period, campaignId: null, campaignName: null, value: latest.fraudRatePct,
    });
  }

  return NextResponse.json(GetAlertsResponse.parse(alerts));
}
