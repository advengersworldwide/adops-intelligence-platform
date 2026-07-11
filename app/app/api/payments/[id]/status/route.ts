import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, paymentsTable, paymentBillingsTable, billingsTable } from "@workspace/db";
import { UpdatePaymentStatusBody } from "@workspace/api-zod";

export const runtime = "nodejs";

async function mapPayment(p: typeof paymentsTable.$inferSelect) {
  const pbRows = await db.select().from(paymentBillingsTable)
    .innerJoin(billingsTable, eq(paymentBillingsTable.billingId, billingsTable.id))
    .where(eq(paymentBillingsTable.paymentId, p.id));
  const allocations = pbRows.map(({ payment_billings: pb, billings: bl }) => ({
    billingId: pb.billingId, billingLabel: bl.invoiceCode ?? `Billing #${bl.id}`, amountApplied: Number(pb.amountApplied),
  }));
  return {
    id: p.id, mode: p.mode, totalAmount: Number(p.totalAmount), notes: p.notes ?? null,
    chequeImageUrl: p.chequeImageUrl ?? null, receiptUrl: p.receiptUrl ?? null,
    paymentDate: p.paymentDate ?? null, status: p.status, createdBy: p.createdBy ?? null,
    createdAt: p.createdAt.toISOString(), allocations,
  };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdatePaymentStatusBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [p] = await db.update(paymentsTable).set({ status: parsed.data.status })
    .where(eq(paymentsTable.id, Number(id))).returning();
  if (!p) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  return NextResponse.json(await mapPayment(p));
}
