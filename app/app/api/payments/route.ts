import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, paymentsTable, paymentBillingsTable, billingsTable } from "@workspace/db";
import { ListPaymentsResponse, CreatePaymentBody, UpdatePaymentResponse } from "@workspace/api-zod";
import { billingNetReceivable } from "../billings/route";

export const runtime = "nodejs";

async function mapPayment(p: typeof paymentsTable.$inferSelect) {
  const pbRows = await db.select().from(paymentBillingsTable).innerJoin(billingsTable, eq(paymentBillingsTable.billingId, billingsTable.id)).where(eq(paymentBillingsTable.paymentId, p.id));
  const allocations = pbRows.map(({ payment_billings: pb, billings: bl }) => ({ billingId: pb.billingId, billingLabel: bl.invoiceCode ?? `Billing #${bl.id}`, amountApplied: Number(pb.amountApplied) }));
  return { id: p.id, mode: p.mode, totalAmount: Number(p.totalAmount), notes: p.notes ?? null, chequeImageUrl: p.chequeImageUrl ?? null, receiptUrl: p.receiptUrl ?? null, paymentDate: p.paymentDate ?? null, createdBy: p.createdBy ?? null, createdAt: p.createdAt.toISOString(), allocations };
}

export async function GET(): Promise<Response> {
  const rows = await db.select().from(paymentsTable).orderBy(paymentsTable.createdAt);
  return NextResponse.json(ListPaymentsResponse.parse(await Promise.all(rows.map(mapPayment))));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreatePaymentBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  for (const a of parsed.data.allocations) {
    const netReceivable = await billingNetReceivable(a.billingId);
    const otherPaidRows = await db.select({ amt: paymentBillingsTable.amountApplied })
      .from(paymentBillingsTable).where(eq(paymentBillingsTable.billingId, a.billingId));
    const otherPaid = otherPaidRows.reduce((s, r) => s + Number(r.amt), 0);
    const remaining = netReceivable - otherPaid;
    if (a.amountApplied > remaining + 0.01) {
      const [bl] = await db.select().from(billingsTable).where(eq(billingsTable.id, a.billingId));
      const label = bl?.invoiceCode ?? `#${a.billingId}`;
      return NextResponse.json({ error: `Payment for ${label} exceeds remaining PKR ${remaining.toFixed(2)}` }, { status: 400 });
    }
  }
  try {
    const totalAmount = parsed.data.allocations.reduce((s, a) => s + a.amountApplied, 0);
    const [payment] = await db.insert(paymentsTable).values({ mode: parsed.data.mode, totalAmount: String(totalAmount), notes: parsed.data.notes ?? null, chequeImageUrl: parsed.data.chequeImageUrl ?? null, receiptUrl: parsed.data.receiptUrl ?? null, paymentDate: parsed.data.paymentDate ?? null }).returning();
    if (parsed.data.allocations.length > 0) await db.insert(paymentBillingsTable).values(parsed.data.allocations.map(a => ({ paymentId: payment.id, billingId: a.billingId, amountApplied: String(a.amountApplied) })));
    return NextResponse.json(UpdatePaymentResponse.parse(await mapPayment(payment)), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create payment" }, { status: 500 });
  }
}
