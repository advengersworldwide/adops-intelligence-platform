import { NextResponse } from "next/server";
import { eq, count } from "drizzle-orm";
import { db, buyingHousesTable, billingRecordsTable, clientsTable } from "@workspace/db";
import { computeRow } from "@/lib/compute-row";
import { GetBuyingHouseParams, UpdateBuyingHouseParams, DeleteBuyingHouseParams, CreateBuyingHouseBody, GetBuyingHouseResponse } from "@workspace/api-zod";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

async function aggregateBH(bhId: number) {
  const records = await db.select().from(billingRecordsTable).where(eq(billingRecordsTable.buyingHouseId, bhId));
  let totalReceivablePkr = 0, totalPayablePkr = 0;
  for (const r of records) { const c = computeRow(r); totalReceivablePkr += c.receivablePkr; totalPayablePkr += c.totalPayablePkr; }
  return { totalReceivablePkr, totalPayablePkr, netMarginPkr: totalReceivablePkr - totalPayablePkr };
}

function mapBH(bh: typeof buyingHousesTable.$inferSelect) {
  return {
    id: bh.id, name: bh.name,
    address: bh.address, pocName: bh.pocName, pocNumber: bh.pocNumber, pocEmail: bh.pocEmail,
    companyEmail: bh.companyEmail, companyNumber: bh.companyNumber, bankName: bh.bankName,
    bankAccountNumber: bh.bankAccountNumber, bankAddress: bh.bankAddress, swiftCode: bh.swiftCode, iban: bh.iban,
    salesTaxNumber: bh.salesTaxNumber, ntnNumber: bh.ntnNumber, createdAt: bh.createdAt.toISOString(),
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("buying-houses:view");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const p = GetBuyingHouseParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, p.data.id));
  if (!bh) return NextResponse.json({ error: "Buying house not found" }, { status: 404 });
  const [{ clientCount }] = await db.select({ clientCount: count() }).from(clientsTable).where(eq(clientsTable.buyingHouseId, bh.id));
  const { netMarginPkr } = await aggregateBH(bh.id);
  return NextResponse.json(GetBuyingHouseResponse.parse({ ...mapBH(bh), clientCount: Number(clientCount), netMarginPkr }));
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("buying-houses:edit");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const p = UpdateBuyingHouseParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreateBuyingHouseBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const d = parsed.data;
  const updates: Record<string, unknown> = { name: d.name };
  const kycKeys = ["address","pocName","pocNumber","pocEmail","companyEmail","companyNumber","bankName","bankAccountNumber","bankAddress","swiftCode","iban","salesTaxNumber","ntnNumber"] as const;
  for (const k of kycKeys) if ((d as Record<string, unknown>)[k] !== undefined) updates[k] = (d as Record<string, unknown>)[k];
  const [row] = await db.update(buyingHousesTable).set(updates).where(eq(buyingHousesTable.id, p.data.id)).returning();
  if (!row) return NextResponse.json({ error: "Buying house not found" }, { status: 404 });
  const [{ clientCount }] = await db.select({ clientCount: count() }).from(clientsTable).where(eq(clientsTable.buyingHouseId, row.id));
  const { netMarginPkr } = await aggregateBH(row.id);
  return NextResponse.json(GetBuyingHouseResponse.parse({ ...mapBH(row), clientCount: Number(clientCount), netMarginPkr }));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("buying-houses:delete");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const p = DeleteBuyingHouseParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  try {
    const [row] = await db.delete(buyingHousesTable).where(eq(buyingHousesTable.id, p.data.id)).returning();
    if (!row) return NextResponse.json({ error: "Buying house not found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (err: unknown) {
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.code ?? e.cause?.code) === "23503") return NextResponse.json({ error: "Cannot delete: this buying house has billing records linked to it." }, { status: 400 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete" }, { status: 500 });
  }
}
