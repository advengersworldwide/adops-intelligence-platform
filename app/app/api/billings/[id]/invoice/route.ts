import { NextResponse } from "next/server";
import { eq, and, isNotNull, count, sql } from "drizzle-orm";
import { db, billingsTable, clientsTable } from "@workspace/db";
import { formatPoCode } from "@/lib/po-codes";
import { mapBilling } from "../../route";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requirePermission("billings:generate-invoice");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const [b] = await db.select().from(billingsTable).where(eq(billingsTable.id, Number(id)));
  if (!b) return NextResponse.json({ error: "Billing not found" }, { status: 404 });
  if (b.status !== "approved") return NextResponse.json({ error: "Billing must be approved to generate an invoice" }, { status: 409 });
  if (b.invoiceCode) return NextResponse.json(await mapBilling(b)); // idempotent

  const [client] = await db.select({ codePrefix: clientsTable.codePrefix }).from(clientsTable).where(eq(clientsTable.id, b.clientId));
  const prefix = client?.codePrefix?.trim();
  if (!prefix) return NextResponse.json({ error: "Set a code prefix on the client first" }, { status: 400 });

  const now = new Date();
  const [{ value }] = await db.select({ value: count() }).from(billingsTable).where(and(
    eq(billingsTable.clientId, b.clientId),
    isNotNull(billingsTable.invoiceCode),
    sql`extract(year from ${billingsTable.invoiceGeneratedAt}) = ${now.getFullYear()}`,
  ));
  const invoiceCode = "CBILL-" + formatPoCode(prefix, now, Number(value) + 1);
  const [updated] = await db.update(billingsTable)
    .set({ invoiceCode, invoiceGeneratedAt: now }).where(eq(billingsTable.id, b.id)).returning();
  return NextResponse.json(await mapBilling(updated));
}
