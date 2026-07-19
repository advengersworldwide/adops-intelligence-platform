import { NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import {
  db, transactionsTable, campaignsTable, clientsTable, partnersTable,
  billingsTable, paymentBillingsTable, paymentsTable,
  partnerPurchaseOrdersTable, partnerBillsTable, billingRecordsTable,
} from "@workspace/db";
import { GetAlertsResponse } from "@workspace/api-zod";
import { billingNetReceivable } from "@/app/api/billings/route";
import { buildFraudSeries } from "@/lib/analytics/fraud";
import { formatMoney } from "@/lib/analytics/currency";

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

export async function GET(): Promise<Response> {
  const rows = await db.select({
    campaignId: campaignsTable.id, campaignName: campaignsTable.name,
    clientName: clientsTable.name, platformName: partnersTable.name,
    totalSpend: sql<string>`coalesce(sum(${transactionsTable.spend}), 0)`,
    totalProfit: sql<string>`coalesce(sum(${transactionsTable.profit}), 0)`,
  }).from(campaignsTable)
    .leftJoin(clientsTable, eq(clientsTable.id, campaignsTable.clientId))
    .leftJoin(partnersTable, eq(partnersTable.id, campaignsTable.platformId))
    .leftJoin(transactionsTable, eq(transactionsTable.campaignId, campaignsTable.id))
    .groupBy(campaignsTable.id, campaignsTable.name, clientsTable.name, partnersTable.name)
    .having(sql`count(${transactionsTable.id}) > 0`);

  const alerts: AlertRow[] = [];

  for (const row of rows) {
    const spend = parseFloat(row.totalSpend ?? "0");
    const profit = parseFloat(row.totalProfit ?? "0");
    const margin = spend > 0 ? (profit / spend) * 100 : 0;
    if (profit < 0) {
      alerts.push({ id: `neg-${row.campaignId}`, type: "negative_profit", severity: "critical", message: `Campaign "${row.campaignName}" has negative profit of $${Math.abs(profit).toFixed(2)}`, campaignId: row.campaignId, campaignName: row.campaignName, clientName: row.clientName ?? null, platformName: row.platformName ?? null, value: profit });
    } else if (margin < 10) {
      alerts.push({ id: `low-${row.campaignId}`, type: "low_margin", severity: "warning", message: `Campaign "${row.campaignName}" has low margin of ${margin.toFixed(1)}%`, campaignId: row.campaignId, campaignName: row.campaignName, clientName: row.clientName ?? null, platformName: row.platformName ?? null, value: margin });
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
