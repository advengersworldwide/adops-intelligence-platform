import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, paymentsTable, paymentBillsTable, billsTable } from "@workspace/db";
import { ListPaymentsResponse, CreatePaymentBody, UpdatePaymentResponse } from "@workspace/api-zod";

export const runtime = "nodejs";

async function mapPayment(p: typeof paymentsTable.$inferSelect) {
  const pbRows = await db.select().from(paymentBillsTable).innerJoin(billsTable, eq(paymentBillsTable.billId, billsTable.id)).where(eq(paymentBillsTable.paymentId, p.id));
  const allocations = pbRows.map(({ payment_bills: pb, bills: b }) => ({ billId: pb.billId, billNumber: b.billNumber, amountApplied: Number(pb.amountApplied) }));
  return { id: p.id, mode: p.mode, totalAmount: Number(p.totalAmount), notes: p.notes ?? null, chequeImageUrl: p.chequeImageUrl ?? null, receiptUrl: p.receiptUrl ?? null, createdBy: p.createdBy ?? null, createdAt: p.createdAt.toISOString(), allocations };
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
  try {
    const totalAmount = parsed.data.allocations.reduce((s, a) => s + a.amountApplied, 0);
    const [payment] = await db.insert(paymentsTable).values({ mode: parsed.data.mode, totalAmount: String(totalAmount), notes: parsed.data.notes ?? null, chequeImageUrl: parsed.data.chequeImageUrl ?? null, receiptUrl: parsed.data.receiptUrl ?? null }).returning();
    if (parsed.data.allocations.length > 0) await db.insert(paymentBillsTable).values(parsed.data.allocations.map(a => ({ paymentId: payment.id, billId: a.billId, amountApplied: String(a.amountApplied) })));
    return NextResponse.json(UpdatePaymentResponse.parse(await mapPayment(payment)), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create payment" }, { status: 500 });
  }
}
