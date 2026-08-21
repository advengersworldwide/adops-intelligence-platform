import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, partnerPaymentsTable, partnerBillsTable } from "@workspace/db";
import { UpdatePartnerPaymentBody } from "@workspace/api-zod";
import { mapPartnerPayment, billRemaining, validateSource } from "../route";
import { requirePermission, isAuthError } from "@/lib/auth/require";
import { fkViolationResponse } from "@/lib/dependencies/fk-error";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requirePermission("payments:edit");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const paymentId = Number(id);
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdatePartnerPaymentBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const [bill] = await db.select({ partnerId: partnerBillsTable.partnerId }).from(partnerBillsTable).where(eq(partnerBillsTable.id, parsed.data.partnerBillId));
  if (!bill) return NextResponse.json({ error: "Partner bill not found" }, { status: 400 });

  const srcErr = await validateSource(parsed.data.sourceClientPaymentId);
  if (srcErr) return NextResponse.json({ error: srcErr }, { status: 400 });

  const rem = await billRemaining(parsed.data.partnerBillId, paymentId);
  if (!rem) return NextResponse.json({ error: "Partner bill not found" }, { status: 400 });
  if (parsed.data.amount > rem.remaining + 0.01) {
    return NextResponse.json({ error: `Amount exceeds remaining USD ${rem.remaining.toFixed(2)} on this bill` }, { status: 400 });
  }

  const [row] = await db.update(partnerPaymentsTable).set({
    partnerId: bill.partnerId,
    partnerBillId: parsed.data.partnerBillId,
    sourceClientPaymentId: parsed.data.sourceClientPaymentId ?? null,
    amount: String(parsed.data.amount),
    mode: parsed.data.mode ?? null,
    attachmentUrl: parsed.data.attachmentUrl ?? null,
    paymentDate: parsed.data.paymentDate ?? null,
    notes: parsed.data.notes ?? null,
  }).where(eq(partnerPaymentsTable.id, paymentId)).returning();
  if (!row) return NextResponse.json({ error: "Partner payment not found" }, { status: 404 });
  return NextResponse.json(await mapPartnerPayment(row));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requirePermission("payments:edit");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  try {
    const [row] = await db.delete(partnerPaymentsTable).where(eq(partnerPaymentsTable.id, Number(id))).returning();
    if (!row) return NextResponse.json({ error: "Partner payment not found" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (err: unknown) {
    const fk = fkViolationResponse(err);
    if (fk) return fk;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete" }, { status: 500 });
  }
}
