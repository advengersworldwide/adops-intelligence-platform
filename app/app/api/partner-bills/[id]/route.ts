import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, partnerBillsTable } from "@workspace/db";
import { UpdatePartnerBillBody } from "@workspace/api-zod";
import { mapPartnerBill } from "../route";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requirePermission("billings:edit");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdatePartnerBillBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.update(partnerBillsTable).set({
    partnerInvoiceNumber: parsed.data.partnerInvoiceNumber ?? null,
    partnerId: parsed.data.partnerId,
    clientId: parsed.data.clientId ?? null,
    partnerPurchaseOrderId: parsed.data.partnerPurchaseOrderId ?? null,
    amount: String(parsed.data.amount),
    attachmentUrl: parsed.data.attachmentUrl ?? null,
    attachmentName: parsed.data.attachmentName ?? null,
    dateReceived: parsed.data.dateReceived ?? null,
    notes: parsed.data.notes ?? null,
  }).where(eq(partnerBillsTable.id, Number(id))).returning();
  if (!row) return NextResponse.json({ error: "Partner bill not found" }, { status: 404 });
  return NextResponse.json(await mapPartnerBill(row));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requirePermission("billings:edit");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const [row] = await db.delete(partnerBillsTable).where(eq(partnerBillsTable.id, Number(id))).returning();
  if (!row) return NextResponse.json({ error: "Partner bill not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
