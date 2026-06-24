import { NextResponse } from "next/server";
import { eq, count } from "drizzle-orm";
import { db, clientPurchaseOrdersTable, partnerPurchaseOrdersTable } from "@workspace/db";
import { UpdateClientPurchaseOrderBody } from "@workspace/api-zod";
import { mapCpoRow } from "../route";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const [row] = await db.select().from(clientPurchaseOrdersTable).where(eq(clientPurchaseOrdersTable.id, Number(id)));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await mapCpoRow(row));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdateClientPurchaseOrderBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.update(clientPurchaseOrdersTable).set({
    ...(parsed.data.clientId !== undefined ? { clientId: parsed.data.clientId } : {}),
    ...(parsed.data.attachmentUrl !== undefined ? { attachmentUrl: parsed.data.attachmentUrl } : {}),
    ...(parsed.data.attachmentName !== undefined ? { attachmentName: parsed.data.attachmentName } : {}),
  }).where(eq(clientPurchaseOrdersTable.id, Number(id))).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await mapCpoRow(row));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const [{ value }] = await db.select({ value: count() }).from(partnerPurchaseOrdersTable)
    .where(eq(partnerPurchaseOrdersTable.clientPurchaseOrderId, Number(id)));
  if (Number(value) > 0) {
    return NextResponse.json({ error: "Remove linked Partner POs first" }, { status: 409 });
  }
  await db.delete(clientPurchaseOrdersTable).where(eq(clientPurchaseOrdersTable.id, Number(id)));
  return new NextResponse(null, { status: 204 });
}
