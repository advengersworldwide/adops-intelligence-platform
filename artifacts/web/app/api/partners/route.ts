import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, partnersTable, paymentTermsTable } from "@workspace/db";
import { CreatePartnerBody, ListPartnersResponse, GetPartnerResponse } from "@workspace/api-zod";

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

export async function GET(): Promise<Response> {
  const rows = await db.select().from(partnersTable).orderBy(partnersTable.createdAt);
  const mapped = await Promise.all(rows.map(mapRow));
  return NextResponse.json(ListPartnersResponse.parse(mapped));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreatePartnerBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.insert(partnersTable).values(parsed.data).returning();
  return NextResponse.json(GetPartnerResponse.parse(await mapRow(row)), { status: 201 });
}
