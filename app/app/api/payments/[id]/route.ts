import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, paymentsTable, paymentBillsTable, billsTable } from "@workspace/db";
import { UpdatePaymentParams, UpdatePaymentBody, DeletePaymentParams, UpdatePaymentResponse } from "@workspace/api-zod";

export const runtime = "nodejs";

async function mapPayment(p: typeof paymentsTable.$inferSelect) {
  const pbRows = await db.select().from(paymentBillsTable).innerJoin(billsTable, eq(paymentBillsTable.billId, billsTable.id)).where(eq(paymentBillsTable.paymentId, p.id));
  const allocations = pbRows.map(({ payment_bills: pb, bills: b }) => ({ billId: pb.billId, billNumber: b.billNumber, amountApplied: Number(pb.amountApplied) }));
  return { id: p.id, mode: p.mode, totalAmount: Number(p.totalAmount), notes: p.notes ?? null, chequeImageUrl: p.chequeImageUrl ?? null, receiptUrl: p.receiptUrl ?? null, createdBy: p.createdBy ?? null, createdAt: p.createdAt.toISOString(), allocations };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const p = UpdatePaymentParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdatePaymentBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const totalAmount = parsed.data.allocations.reduce((s, a) => s + a.amountApplied, 0);
    const [payment] = await db.update(paymentsTable).set({ mode: parsed.data.mode, totalAmount: String(totalAmount), notes: parsed.data.notes ?? null, chequeImageUrl: parsed.data.chequeImageUrl ?? null, receiptUrl: parsed.data.receiptUrl ?? null }).where(eq(paymentsTable.id, p.data.id)).returning();
    if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    await db.delete(paymentBillsTable).where(eq(paymentBillsTable.paymentId, payment.id));
    if (parsed.data.allocations.length > 0) await db.insert(paymentBillsTable).values(parsed.data.allocations.map(a => ({ paymentId: payment.id, billId: a.billId, amountApplied: String(a.amountApplied) })));
    return NextResponse.json(UpdatePaymentResponse.parse(await mapPayment(payment)));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to update payment" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const p = DeletePaymentParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const [row] = await db.delete(paymentsTable).where(eq(paymentsTable.id, p.data.id)).returning();
  if (!row) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
