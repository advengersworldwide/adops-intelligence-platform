import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, clientsTable, buyingHousesTable, paymentTermsTable } from "@workspace/db";
import { GetClientParams, UpdateClientBody, UpdateClientParams, DeleteClientParams, GetClientResponse, UpdateClientResponse } from "@workspace/api-zod";

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
    id: r.id, name: r.name, codePrefix: r.codePrefix, buyingHouseId: r.buyingHouseId ?? null, buyingHouseName,
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const p = GetClientParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const [row] = await db.select().from(clientsTable).where(eq(clientsTable.id, p.data.id));
  if (!row) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  return NextResponse.json(GetClientResponse.parse(await mapRow(row)));
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const p = UpdateClientParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdateClientBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const d = parsed.data;
  const updates: Record<string, unknown> = {};
  const textKeys = ["name","codePrefix","buyingHouseId","address","pocName","pocNumber","pocEmail","companyEmail","companyNumber","bankName","bankAccountNumber","bankAddress","swiftCode","iban","salesTaxNumber","ntnNumber","paymentTermsId"] as const;
  for (const k of textKeys) if ((d as Record<string, unknown>)[k] !== undefined) updates[k] = (d as Record<string, unknown>)[k];
  if (d.salesTaxPct !== undefined) updates.salesTaxPct = d.salesTaxPct != null ? String(d.salesTaxPct) : null;
  if (d.withholdingTaxPct !== undefined) updates.withholdingTaxPct = d.withholdingTaxPct != null ? String(d.withholdingTaxPct) : null;
  const [row] = await db.update(clientsTable).set(updates).where(eq(clientsTable.id, p.data.id)).returning();
  if (!row) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  return NextResponse.json(UpdateClientResponse.parse(await mapRow(row)));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const p = DeleteClientParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const [row] = await db.delete(clientsTable).where(eq(clientsTable.id, p.data.id)).returning();
  if (!row) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
