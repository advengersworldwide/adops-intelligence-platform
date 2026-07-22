import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, costResourcesTable } from "@workspace/db";
import { UpdateCostResourceParams, UpdateCostResourceBody, DeleteCostResourceParams, UpdateCostResourceResponse } from "@workspace/api-zod";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

function mapCost(r: typeof costResourcesTable.$inferSelect) {
  return { id: r.id, name: r.name, amount: Number(r.amount), period: r.period, notes: r.notes ?? null, createdBy: r.createdBy ?? null, createdAt: r.createdAt.toISOString() };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("cost:edit");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const p = UpdateCostResourceParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdateCostResourceBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.update(costResourcesTable).set({ name: parsed.data.name, amount: String(parsed.data.amount), period: parsed.data.period, notes: parsed.data.notes ?? null }).where(eq(costResourcesTable.id, p.data.id)).returning();
  if (!row) return NextResponse.json({ error: "Cost resource not found" }, { status: 404 });
  return NextResponse.json(UpdateCostResourceResponse.parse(mapCost(row)));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("cost:edit");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const p = DeleteCostResourceParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const [row] = await db.delete(costResourcesTable).where(eq(costResourcesTable.id, p.data.id)).returning();
  if (!row) return NextResponse.json({ error: "Cost resource not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
