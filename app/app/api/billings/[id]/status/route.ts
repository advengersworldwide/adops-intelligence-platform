import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, billingsTable } from "@workspace/db";
import { UpdateBillingStatusBody } from "@workspace/api-zod";
import { mapBilling } from "../../route";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requirePermission("billings:change-status");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdateBillingStatusBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [b] = await db.update(billingsTable).set({ status: parsed.data.status })
    .where(eq(billingsTable.id, Number(id))).returning();
  if (!b) return NextResponse.json({ error: "Billing not found" }, { status: 404 });
  return NextResponse.json(await mapBilling(b));
}
