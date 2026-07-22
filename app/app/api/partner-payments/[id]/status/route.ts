import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, partnerPaymentsTable } from "@workspace/db";
import { UpdatePartnerPaymentStatusBody } from "@workspace/api-zod";
import { mapPartnerPayment } from "../../route";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requirePermission("partner-payments:change-status");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdatePartnerPaymentStatusBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.update(partnerPaymentsTable).set({ status: parsed.data.status })
    .where(eq(partnerPaymentsTable.id, Number(id))).returning();
  if (!row) return NextResponse.json({ error: "Partner payment not found" }, { status: 404 });
  return NextResponse.json(await mapPartnerPayment(row));
}
