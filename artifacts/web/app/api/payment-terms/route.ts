import { NextResponse } from "next/server";
import { db, paymentTermsTable } from "@workspace/db";
import { CreatePaymentTermBody, ListPaymentTermsResponse, ListPaymentTermsResponseItem } from "@workspace/api-zod";

export const runtime = "nodejs";

function mapRow(r: typeof paymentTermsTable.$inferSelect) {
  return { id: r.id, name: r.name, createdAt: r.createdAt.toISOString() };
}

export async function GET(): Promise<Response> {
  const rows = await db.select().from(paymentTermsTable).orderBy(paymentTermsTable.createdAt);
  return NextResponse.json(ListPaymentTermsResponse.parse(rows.map(mapRow)));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreatePaymentTermBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.insert(paymentTermsTable).values({ name: parsed.data.name }).returning();
  return NextResponse.json(ListPaymentTermsResponseItem.parse(mapRow(row)), { status: 201 });
}
