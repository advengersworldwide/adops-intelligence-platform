import { NextResponse } from "next/server";
import { eq, and, ne } from "drizzle-orm";
import { db, paymentsTable, paymentBillingsTable, billingsTable } from "@workspace/db";
import { UpdatePaymentParams, UpdatePaymentBody, DeletePaymentParams, UpdatePaymentResponse } from "@workspace/api-zod";
import { billingNetReceivable } from "../../billings/route";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

async function mapPayment(p: typeof paymentsTable.$inferSelect) {
  const pbRows = await db.select().from(paymentBillingsTable).innerJoin(billingsTable, eq(paymentBillingsTable.billingId, billingsTable.id)).where(eq(paymentBillingsTable.paymentId, p.id));
  const allocations = pbRows.map(({ payment_billings: pb, billings: bl }) => ({ billingId: pb.billingId, billingLabel: bl.invoiceCode ?? `Billing #${bl.id}`, amountApplied: Number(pb.amountApplied) }));
  return { id: p.id, mode: p.mode, totalAmount: Number(p.totalAmount), notes: p.notes ?? null, chequeImageUrl: p.chequeImageUrl ?? null, receiptUrl: p.receiptUrl ?? null, paymentDate: p.paymentDate ?? null, status: p.status, createdBy: p.createdBy ?? null, createdAt: p.createdAt.toISOString(), allocations };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("payments:edit");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const p = UpdatePaymentParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdatePaymentBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  for (const a of parsed.data.allocations) {
    const netReceivable = await billingNetReceivable(a.billingId);
    const otherPaidRows = await db.select({ amt: paymentBillingsTable.amountApplied })
      .from(paymentBillingsTable)
      .where(and(eq(paymentBillingsTable.billingId, a.billingId), ne(paymentBillingsTable.paymentId, p.data.id)));
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
    const [payment] = await db.update(paymentsTable).set({ mode: parsed.data.mode, totalAmount: String(totalAmount), notes: parsed.data.notes ?? null, chequeImageUrl: parsed.data.chequeImageUrl ?? null, receiptUrl: parsed.data.receiptUrl ?? null, paymentDate: parsed.data.paymentDate ?? null, status: parsed.data.status ?? "pending" }).where(eq(paymentsTable.id, p.data.id)).returning();
    if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    await db.delete(paymentBillingsTable).where(eq(paymentBillingsTable.paymentId, payment.id));
    if (parsed.data.allocations.length > 0) await db.insert(paymentBillingsTable).values(parsed.data.allocations.map(a => ({ paymentId: payment.id, billingId: a.billingId, amountApplied: String(a.amountApplied) })));
    return NextResponse.json(UpdatePaymentResponse.parse(await mapPayment(payment)));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to update payment" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("payments:edit");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const p = DeletePaymentParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const [row] = await db.delete(paymentsTable).where(eq(paymentsTable.id, p.data.id)).returning();
  if (!row) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
