import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, billingsTable, billingLinesTable, billingEventItemsTable } from "@workspace/db";
import { UpdateBillingBody } from "@workspace/api-zod";
import { mapBilling } from "../route";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const [b] = await db.select().from(billingsTable).where(eq(billingsTable.id, Number(id)));
  if (!b) return NextResponse.json({ error: "Billing not found" }, { status: 404 });
  return NextResponse.json(await mapBilling(b));
}

async function replaceLines(billingId: number, lines: { partnerId: number; partnerPurchaseOrderId?: number | null; items: { clientEventId: number; eventName: string; billableRate: number; payoutRate: number; eventCount: number }[] }[]) {
  const existing = await db.select({ id: billingLinesTable.id }).from(billingLinesTable).where(eq(billingLinesTable.billingId, billingId));
  for (const ln of existing) await db.delete(billingEventItemsTable).where(eq(billingEventItemsTable.billingLineId, ln.id));
  await db.delete(billingLinesTable).where(eq(billingLinesTable.billingId, billingId));
  for (const line of lines) {
    const [ln] = await db.insert(billingLinesTable).values({
      billingId, partnerId: line.partnerId, partnerPurchaseOrderId: line.partnerPurchaseOrderId ?? null,
    }).returning();
    if (line.items.length) {
      await db.insert(billingEventItemsTable).values(line.items.map(it => ({
        billingLineId: ln.id, clientEventId: it.clientEventId, eventName: it.eventName,
        billableRate: String(it.billableRate), payoutRate: String(it.payoutRate), eventCount: it.eventCount,
      })));
    }
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdateBillingBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [b] = await db.update(billingsTable).set({
    clientId: parsed.data.clientId,
    clientPurchaseOrderId: parsed.data.clientPurchaseOrderId,
    period: parsed.data.period,
    forexSellingRate: String(parsed.data.forexSellingRate),
    forexBuyingRate: String(parsed.data.forexBuyingRate),
    bulkDiscountPct: String(parsed.data.bulkDiscountPct),
    whtApplied: parsed.data.whtApplied,
    notes: parsed.data.notes ?? null,
  }).where(eq(billingsTable.id, Number(id))).returning();
  if (!b) return NextResponse.json({ error: "Billing not found" }, { status: 404 });
  await replaceLines(b.id, parsed.data.lines);
  return NextResponse.json(await mapBilling(b));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const [row] = await db.delete(billingsTable).where(eq(billingsTable.id, Number(id))).returning();
  if (!row) return NextResponse.json({ error: "Billing not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
