import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, clientsTable, buyingHousesTable, paymentTermsTable } from "@workspace/db";
import { CreateClientBody, ListClientsResponse, GetClientResponse } from "@workspace/api-zod";

export const runtime = "nodejs";

async function mapRow(r: typeof clientsTable.$inferSelect) {
  let buyingHouseName: string | null = null;
  if (r.buyingHouseId != null) {
    const [bh] = await db.select({ name: buyingHousesTable.name }).from(buyingHousesTable).where(eq(buyingHousesTable.id, r.buyingHouseId));
    buyingHouseName = bh?.name ?? null;
  }
  let paymentTermName: string | null = null;
  if (r.paymentTermsId != null) {
    const [pt] = await db.select({ name: paymentTermsTable.name }).from(paymentTermsTable).where(eq(paymentTermsTable.id, r.paymentTermsId));
    paymentTermName = pt?.name ?? null;
  }
  return {
    id: r.id, name: r.name, buyingHouseId: r.buyingHouseId ?? null, buyingHouseName,
    address: r.address, pocName: r.pocName, pocNumber: r.pocNumber, pocEmail: r.pocEmail,
    companyEmail: r.companyEmail, companyNumber: r.companyNumber,
    bankName: r.bankName, bankAccountNumber: r.bankAccountNumber, bankAddress: r.bankAddress,
    swiftCode: r.swiftCode, iban: r.iban,
    salesTaxNumber: r.salesTaxNumber, ntnNumber: r.ntnNumber,
    salesTaxPct: r.salesTaxPct != null ? Number(r.salesTaxPct) : null,
    withholdingTaxPct: r.withholdingTaxPct != null ? Number(r.withholdingTaxPct) : null,
    paymentTermsId: r.paymentTermsId ?? null, paymentTermName,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function GET(): Promise<Response> {
  const rows = await db.select().from(clientsTable).orderBy(clientsTable.createdAt);
  const mapped = await Promise.all(rows.map(mapRow));
  return NextResponse.json(ListClientsResponse.parse(mapped));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreateClientBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.insert(clientsTable).values({
    name: parsed.data.name,
    buyingHouseId: parsed.data.buyingHouseId ?? null,
  }).returning();
  return NextResponse.json(GetClientResponse.parse(await mapRow(row)), { status: 201 });
}
