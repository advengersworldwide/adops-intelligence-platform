import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, billingRecordsTable, buyingHousesTable, costModelsTable, clientsTable } from "@workspace/db";
import { getSession } from "@/lib/auth/session";
import {
  ListBillingRecordsParams, ListBillingRecordsQueryParams, ListBillingRecordsResponse,
  CreateBillingRecordParams, CreateBillingRecordBody, ListBillingRecordsResponseItem,
} from "@workspace/api-zod";
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("billings:view");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const p = ListBillingRecordsParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const url = new URL(req.url);
  const qp = ListBillingRecordsQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });
  const conditions = [eq(billingRecordsTable.platformId, p.data.id)];
  if (qp.data.period != null) conditions.push(eq(billingRecordsTable.period, qp.data.period));
  if (qp.data.buyingHouseId != null) conditions.push(eq(billingRecordsTable.buyingHouseId, qp.data.buyingHouseId));
  if (qp.data.clientId != null) conditions.push(eq(billingRecordsTable.clientId, qp.data.clientId));
  const rows = await db.select().from(billingRecordsTable).where(and(...conditions)).orderBy(billingRecordsTable.createdAt);
  return NextResponse.json(ListBillingRecordsResponse.parse(await Promise.all(rows.map(mapRecord))));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("billings:edit");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const p = CreateBillingRecordParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreateBillingRecordBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const session = await getSession();
    const createdBy: string | null = session?.name ?? session?.email ?? null;
    const [row] = await db.insert(billingRecordsTable).values({
      platformId: p.data.id,
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
      createdBy,
    }).returning();
    return NextResponse.json(ListBillingRecordsResponseItem.parse(await mapRecord(row)), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create billing record" }, { status: 500 });
  }
}
