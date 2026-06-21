import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, partnersTable, paymentTermsTable } from "@workspace/db";
import { GetPartnerParams, UpdatePartnerBody, UpdatePartnerParams, DeletePartnerParams, GetPartnerResponse, UpdatePartnerResponse } from "@workspace/api-zod";

export const runtime = "nodejs";

async function mapRow(r: typeof partnersTable.$inferSelect) {
  const [pt] = r.paymentTermsId
    ? await db.select({ name: paymentTermsTable.name }).from(paymentTermsTable).where(eq(paymentTermsTable.id, r.paymentTermsId))
    : [];
  return {
    id: r.id, name: r.name, address: r.address, pocName: r.pocName, pocNumber: r.pocNumber, pocEmail: r.pocEmail,
    companyEmail: r.companyEmail, companyNumber: r.companyNumber, bankName: r.bankName,
    bankAccountNumber: r.bankAccountNumber, bankAddress: r.bankAddress, swiftCode: r.swiftCode, iban: r.iban,
    salesTaxNumber: r.salesTaxNumber, ntnNumber: r.ntnNumber,
    paymentTermsId: r.paymentTermsId ?? null, paymentTermName: pt?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const p = GetPartnerParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const [row] = await db.select().from(partnersTable).where(eq(partnersTable.id, p.data.id));
  if (!row) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  return NextResponse.json(GetPartnerResponse.parse(await mapRow(row)));
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const p = UpdatePartnerParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdatePartnerBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.update(partnersTable).set(parsed.data).where(eq(partnersTable.id, p.data.id)).returning();
  if (!row) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  return NextResponse.json(UpdatePartnerResponse.parse(await mapRow(row)));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const p = DeletePartnerParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const [row] = await db.delete(partnersTable).where(eq(partnersTable.id, p.data.id)).returning();
  if (!row) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
