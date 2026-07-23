import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, billingRecordsTable, buyingHousesTable, costModelsTable, clientsTable } from "@workspace/db";
import { DeleteBillingRecordParams, CreateBillingRecordBody, ListBillingRecordsResponseItem } from "@workspace/api-zod";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

async function mapRecord(r: typeof billingRecordsTable.$inferSelect) {
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, r.buyingHouseId));
  const [cm] = await db.select().from(costModelsTable).where(eq(costModelsTable.id, r.costModelId));
  const client = r.clientId
    ? (await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, r.clientId)))[0]
    : null;
  return {
    id: r.id, platformId: r.platformId, buyingHouseId: r.buyingHouseId,
    buyingHouseName: bh?.name ?? null, clientId: r.clientId ?? null, clientName: client?.name ?? null,
    costModelId: r.costModelId, costModelName: cm?.name ?? null, costModelPayoutRate: null, costModelMarginPct: null,
    period: r.period, pins: r.pins, fraudPins: r.fraudPins,
    payoutRate: Number(r.payoutRate), marginPct: Number(r.marginPct),
    forexSellingRate: Number(r.forexSellingRate), forexBuyingRate: Number(r.forexBuyingRate),
    salesTaxPct: Number(r.salesTaxPct), remittanceTaxPct: Number(r.remittanceTaxPct),
    withholdingTaxPct: Number(r.withholdingTaxPct), bulkDiscountPct: Number(r.bulkDiscountPct),
    platformBulkDiscountPct: Number(r.platformBulkDiscountPct),
    createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
  };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> },
): Promise<Response> {
  const auth = await requirePermission("billings:edit");
  if (isAuthError(auth)) return auth;
  const { id, recordId } = await params;
  const p = DeleteBillingRecordParams.safeParse({ id: parseInt(id, 10), recordId: parseInt(recordId, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreateBillingRecordBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const [row] = await db.update(billingRecordsTable).set({
      buyingHouseId: parsed.data.buyingHouseId,
      clientId: parsed.data.clientId ?? null,
      costModelId: parsed.data.costModelId,
      period: parsed.data.period,
      pins: parsed.data.pins,
      fraudPins: parsed.data.fraudPins,
      payoutRate: String(parsed.data.payoutRate),
      marginPct: String(parsed.data.marginPct),
      forexSellingRate: String(parsed.data.forexSellingRate),
      forexBuyingRate: String(parsed.data.forexBuyingRate),
      salesTaxPct: String(parsed.data.salesTaxPct),
      remittanceTaxPct: String(parsed.data.remittanceTaxPct),
      withholdingTaxPct: String(parsed.data.withholdingTaxPct),
      bulkDiscountPct: String(parsed.data.bulkDiscountPct),
      platformBulkDiscountPct: String(parsed.data.platformBulkDiscountPct),
    }).where(and(
      eq(billingRecordsTable.id, p.data.recordId),
      eq(billingRecordsTable.platformId, p.data.id),
    )).returning();
    if (!row) return NextResponse.json({ error: "Billing record not found" }, { status: 404 });
    return NextResponse.json(ListBillingRecordsResponseItem.parse(await mapRecord(row)));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> },
): Promise<Response> {
  const auth = await requirePermission("billings:edit");
  if (isAuthError(auth)) return auth;
  const { id, recordId } = await params;
  const p = DeleteBillingRecordParams.safeParse({ id: parseInt(id, 10), recordId: parseInt(recordId, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const [row] = await db.delete(billingRecordsTable)
    .where(and(eq(billingRecordsTable.id, p.data.recordId), eq(billingRecordsTable.platformId, p.data.id)))
    .returning();
  if (!row) return NextResponse.json({ error: "Billing record not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
