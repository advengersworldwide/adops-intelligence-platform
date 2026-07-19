import { NextResponse } from "next/server";
import { and, eq, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import {
  db, paymentsTable, paymentBillingsTable, billingsTable, partnerPaymentsTable,
} from "@workspace/db";
import { GetCashFlowQueryParams, GetCashFlowResponse } from "@workspace/api-zod";
import type { CashFlowBucket } from "@workspace/api-client-react";
import { parseIdList } from "@/lib/analytics/parse-params";

export const runtime = "nodejs";

// Money IN is PKR (client collections — payments with status "received"), money OUT is USD
// (partner payouts with status "settled"). No currency unification here — the chart converts
// both to the user's base currency before computing the running balance.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetCashFlowQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const clientIds = parseIdList(qp.data.clientIds);
  const partnerIds = parseIdList(qp.data.partnerIds);

  // Inflows: received client payments, grouped by date, optionally restricted to a set of
  // clients via the payment_billings -> billings join (a payment qualifies if ANY of its
  // applied billings belongs to a client in the filter).
  const inflowConds: SQL[] = [eq(paymentsTable.status, "received"), isNotNull(paymentsTable.paymentDate)];
  if (qp.data.dateFrom) inflowConds.push(gte(paymentsTable.paymentDate, qp.data.dateFrom));
  if (qp.data.dateTo) inflowConds.push(lte(paymentsTable.paymentDate, qp.data.dateTo));
  if (clientIds.length) {
    const qualifying = await db.selectDistinct({ paymentId: paymentBillingsTable.paymentId })
      .from(paymentBillingsTable)
      .innerJoin(billingsTable, eq(paymentBillingsTable.billingId, billingsTable.id))
      .where(inArray(billingsTable.clientId, clientIds));
    inflowConds.push(inArray(paymentsTable.id, qualifying.map(r => r.paymentId)));
  }

  const inflowRows = await db.select({
    date: paymentsTable.paymentDate,
    inflowPkr: sql<string>`sum(${paymentsTable.totalAmount})`,
  }).from(paymentsTable).where(and(...inflowConds)).groupBy(paymentsTable.paymentDate);

  // Outflows: settled partner payments, grouped by date, split funded (sourced from a client
  // payment) vs unfunded.
  const outflowConds: SQL[] = [eq(partnerPaymentsTable.status, "settled"), isNotNull(partnerPaymentsTable.paymentDate)];
  if (qp.data.dateFrom) outflowConds.push(gte(partnerPaymentsTable.paymentDate, qp.data.dateFrom));
  if (qp.data.dateTo) outflowConds.push(lte(partnerPaymentsTable.paymentDate, qp.data.dateTo));
  if (partnerIds.length) outflowConds.push(inArray(partnerPaymentsTable.partnerId, partnerIds));

  const outflowRows = await db.select({
    date: partnerPaymentsTable.paymentDate,
    outflowUsd: sql<string>`sum(${partnerPaymentsTable.amount})`,
    fundedOutUsd: sql<string>`sum(case when ${partnerPaymentsTable.sourceClientPaymentId} is not null then ${partnerPaymentsTable.amount} else 0 end)`,
    unfundedOutUsd: sql<string>`sum(case when ${partnerPaymentsTable.sourceClientPaymentId} is null then ${partnerPaymentsTable.amount} else 0 end)`,
  }).from(partnerPaymentsTable).where(and(...outflowConds)).groupBy(partnerPaymentsTable.paymentDate);

  // Merge by date; missing side defaults to 0.
  const byDate = new Map<string, CashFlowBucket>();
  const bucket = (date: string): CashFlowBucket => {
    let b = byDate.get(date);
    if (!b) {
      b = { date, inflowPkr: 0, outflowUsd: 0, fundedOutUsd: 0, unfundedOutUsd: 0 };
      byDate.set(date, b);
    }
    return b;
  };
  for (const r of inflowRows) {
    if (!r.date) continue;
    bucket(r.date).inflowPkr += parseFloat(r.inflowPkr ?? "0");
  }
  for (const r of outflowRows) {
    if (!r.date) continue;
    const b = bucket(r.date);
    b.outflowUsd += parseFloat(r.outflowUsd ?? "0");
    b.fundedOutUsd += parseFloat(r.fundedOutUsd ?? "0");
    b.unfundedOutUsd += parseFloat(r.unfundedOutUsd ?? "0");
  }

  const buckets = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return NextResponse.json(GetCashFlowResponse.parse(buckets));
}
