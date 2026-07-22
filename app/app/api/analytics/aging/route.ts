import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, billingsTable, paymentBillingsTable, paymentsTable,
  partnerBillsTable, partnerPaymentsTable,
} from "@workspace/db";
import { GetAgingQueryParams, GetAgingResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { bucketByAge, type AgingItem } from "@/lib/analytics/aging";
import { billingNetReceivable } from "@/app/api/billings/route";

import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

// AR outstanding is in PKR (billingNetReceivable applies forex). AP outstanding is in USD
// (partnerBillsTable.amount). Returned as separate ar/ap bucket sets — no currency unification here.
export async function GET(req: Request): Promise<Response> {
  const auth = await requirePermission("analytics:view");
  if (isAuthError(auth)) return auth;
  const url = new URL(req.url);
  const qp = GetAgingQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const clientIds = parseIdList(qp.data.clientIds);
  const partnerIds = parseIdList(qp.data.partnerIds);

  // AR: billings' net receivable (PKR) minus amounts collected from received payments.
  const billingConds = clientIds.length ? [inArray(billingsTable.clientId, clientIds)] : [];
  const billings = await db.select().from(billingsTable)
    .where(billingConds.length ? and(...billingConds) : undefined);

  const arItems: AgingItem[] = [];
  for (const b of billings) {
    const netReceivable = await billingNetReceivable(b.id);
    const paidRows = await db.select({ amt: paymentBillingsTable.amountApplied })
      .from(paymentBillingsTable)
      .innerJoin(paymentsTable, eq(paymentBillingsTable.paymentId, paymentsTable.id))
      .where(and(eq(paymentBillingsTable.billingId, b.id), eq(paymentsTable.status, "received")));
    const amountPaid = paidRows.reduce((s, r) => s + Number(r.amt), 0);
    const outstanding = netReceivable - amountPaid;
    if (outstanding > 0) {
      arItems.push({ amount: outstanding, date: b.invoiceGeneratedAt ?? b.createdAt });
    }
  }

  // AP: partner bills' amount (USD) minus amounts settled via partner payments.
  const partnerBillConds = partnerIds.length ? [inArray(partnerBillsTable.partnerId, partnerIds)] : [];
  const partnerBills = await db.select().from(partnerBillsTable)
    .where(partnerBillConds.length ? and(...partnerBillConds) : undefined);

  const apItems: AgingItem[] = [];
  for (const bill of partnerBills) {
    const settledRows = await db.select({ amt: partnerPaymentsTable.amount })
      .from(partnerPaymentsTable)
      .where(and(eq(partnerPaymentsTable.partnerBillId, bill.id), eq(partnerPaymentsTable.status, "settled")));
    const amountSettled = settledRows.reduce((s, r) => s + Number(r.amt), 0);
    const outstanding = Number(bill.amount) - amountSettled;
    if (outstanding > 0) {
      apItems.push({ amount: outstanding, date: bill.dateReceived ?? bill.createdAt });
    }
  }

  return NextResponse.json(GetAgingResponse.parse({
    ar: bucketByAge(arItems, new Date()),
    ap: bucketByAge(apItems, new Date()),
  }));
}
