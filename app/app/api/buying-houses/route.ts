import { NextResponse } from "next/server";
import { eq, count } from "drizzle-orm";
import { db, buyingHousesTable, billingRecordsTable, clientsTable } from "@workspace/db";
import { computeRow } from "@/lib/compute-row";
import { CreateBuyingHouseBody, ListBuyingHousesResponse, GetBuyingHouseResponse } from "@workspace/api-zod";

export const runtime = "nodejs";

async function aggregateBH(bhId: number) {
  const records = await db.select().from(billingRecordsTable).where(eq(billingRecordsTable.buyingHouseId, bhId));
  let totalReceivablePkr = 0, totalPayablePkr = 0;
  for (const r of records) { const c = computeRow(r); totalReceivablePkr += c.receivablePkr; totalPayablePkr += c.totalPayablePkr; }
  return { totalReceivablePkr, totalPayablePkr, netMarginPkr: totalReceivablePkr - totalPayablePkr };
}

function mapBH(bh: typeof buyingHousesTable.$inferSelect) {
  return {
    id: bh.id, name: bh.name, bulkDiscountPct: bh.bulkDiscountPct !== null ? Number(bh.bulkDiscountPct) : null,
    address: bh.address, pocName: bh.pocName, pocNumber: bh.pocNumber, pocEmail: bh.pocEmail,
    companyEmail: bh.companyEmail, companyNumber: bh.companyNumber, bankName: bh.bankName,
    bankAccountNumber: bh.bankAccountNumber, bankAddress: bh.bankAddress, swiftCode: bh.swiftCode, iban: bh.iban,
    salesTaxNumber: bh.salesTaxNumber, ntnNumber: bh.ntnNumber, createdAt: bh.createdAt.toISOString(),
  };
}

export async function GET(): Promise<Response> {
  const bhs = await db.select().from(buyingHousesTable).orderBy(buyingHousesTable.createdAt);
  const result = await Promise.all(bhs.map(async (bh) => {
    const [{ clientCount }] = await db.select({ clientCount: count() }).from(clientsTable).where(eq(clientsTable.buyingHouseId, bh.id));
    const { netMarginPkr } = await aggregateBH(bh.id);
    return { ...mapBH(bh), clientCount: Number(clientCount), netMarginPkr };
  }));
  return NextResponse.json(ListBuyingHousesResponse.parse(result));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreateBuyingHouseBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const d = parsed.data;
  const [row] = await db.insert(buyingHousesTable).values({
    name: d.name, bulkDiscountPct: d.bulkDiscountPct != null ? String(d.bulkDiscountPct) : null,
    address: d.address ?? null, pocName: d.pocName ?? null, pocNumber: d.pocNumber ?? null, pocEmail: d.pocEmail ?? null,
    companyEmail: d.companyEmail ?? null, companyNumber: d.companyNumber ?? null, bankName: d.bankName ?? null,
    bankAccountNumber: d.bankAccountNumber ?? null, bankAddress: d.bankAddress ?? null, swiftCode: d.swiftCode ?? null,
    iban: d.iban ?? null, salesTaxNumber: d.salesTaxNumber ?? null, ntnNumber: d.ntnNumber ?? null,
  }).returning();
  return NextResponse.json(GetBuyingHouseResponse.parse({ ...mapBH(row), clientCount: 0, netMarginPkr: 0 }), { status: 201 });
}
