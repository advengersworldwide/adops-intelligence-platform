import { NextResponse } from "next/server";
import { and, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import { db, billingsTable, paymentBillingsTable, paymentsTable } from "@workspace/db";
import { GetInvoiceFunnelQueryParams, GetInvoiceFunnelResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { collectionState, type CollectionState } from "@/lib/analytics/collection-state";
import { billingNetReceivable } from "@/app/api/billings/route";

import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

const STATUS_LABELS = ["pending", "approved", "dispute"] as const;
const COLLECTION_LABELS = ["outstanding", "partial", "paid"] as const satisfies readonly CollectionState[];

// Amounts are PKR net receivable (billingNetReceivable applies forex) — same basis as the
// aging/cashflow AR figures. No currency unification with AP here.
export async function GET(req: Request): Promise<Response> {
  const auth = await requirePermission("analytics:view");
  if (isAuthError(auth)) return auth;
  const url = new URL(req.url);
  const qp = GetInvoiceFunnelQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const clientIds = parseIdList(qp.data.clientIds);

  const billingConds: SQL[] = [];
  if (clientIds.length) billingConds.push(inArray(billingsTable.clientId, clientIds));
  if (qp.data.dateFrom) billingConds.push(gte(billingsTable.createdAt, new Date(qp.data.dateFrom)));
  if (qp.data.dateTo) billingConds.push(lte(billingsTable.createdAt, new Date(qp.data.dateTo)));

  const billings = await db.select().from(billingsTable)
    .where(billingConds.length ? and(...billingConds) : undefined);

  const byStatus = new Map(STATUS_LABELS.map(label => [label, { count: 0, amount: 0 }]));
  const byCollection = new Map(COLLECTION_LABELS.map(label => [label, { count: 0, amount: 0 }]));

  for (const b of billings) {
    const net = await billingNetReceivable(b.id);
    const paidRows = await db.select({ amt: paymentBillingsTable.amountApplied })
      .from(paymentBillingsTable)
      .innerJoin(paymentsTable, eq(paymentBillingsTable.paymentId, paymentsTable.id))
      .where(and(eq(paymentBillingsTable.billingId, b.id), eq(paymentsTable.status, "received")));
    const collected = paidRows.reduce((s, r) => s + Number(r.amt), 0);

    const statusStage = byStatus.get(b.status as (typeof STATUS_LABELS)[number]);
    if (statusStage) { statusStage.count += 1; statusStage.amount += net; }

    const state = collectionState(net, collected);
    const collectionStage = byCollection.get(state);
    if (collectionStage) { collectionStage.count += 1; collectionStage.amount += net; }
  }

  return NextResponse.json(GetInvoiceFunnelResponse.parse({
    byStatus: STATUS_LABELS.map(label => ({ label, ...byStatus.get(label)! })),
    byCollection: COLLECTION_LABELS.map(label => ({ label, ...byCollection.get(label)! })),
  }));
}
