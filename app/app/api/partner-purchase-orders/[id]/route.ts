import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, partnerPurchaseOrdersTable, partnerPurchaseOrderItemsTable } from "@workspace/db";
import { UpdatePartnerPurchaseOrderBody } from "@workspace/api-zod";
import { mapPpoRow } from "../route";
import { lineBudget, totalBudget } from "@/lib/po-totals";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const [row] = await db.select().from(partnerPurchaseOrdersTable).where(eq(partnerPurchaseOrdersTable.id, Number(id)));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await mapPpoRow(row));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const ppoId = Number(id);
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdatePartnerPurchaseOrderBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { startDate, endDate, items } = parsed.data;

  if (items !== undefined) {
    await db.delete(partnerPurchaseOrderItemsTable).where(eq(partnerPurchaseOrderItemsTable.partnerPurchaseOrderId, ppoId));
    if (items.length) {
      await db.insert(partnerPurchaseOrderItemsTable).values(items.map(i => ({
        partnerPurchaseOrderId: ppoId, clientEventId: i.clientEventId, eventName: i.eventName,
        cacRate: String(i.cacRate), eventCount: i.eventCount, lineBudget: String(lineBudget(i.cacRate, i.eventCount)),
      })));
    }
  }
  const setTotal = items !== undefined
    ? { totalBudget: String(totalBudget(items.map(i => ({ cacRate: i.cacRate, eventCount: i.eventCount })))) }
    : {};
  const [row] = await db.update(partnerPurchaseOrdersTable).set({
    ...(startDate !== undefined ? { startDate } : {}),
    ...(endDate !== undefined ? { endDate } : {}),
    ...setTotal,
  }).where(eq(partnerPurchaseOrdersTable.id, ppoId)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await mapPpoRow(row));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  await db.delete(partnerPurchaseOrdersTable).where(eq(partnerPurchaseOrdersTable.id, Number(id)));
  return new NextResponse(null, { status: 204 });
}
