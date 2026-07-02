import { NextResponse } from "next/server";
import { eq, and, gte, lt, count } from "drizzle-orm";
import {
  db, clientPurchaseOrdersTable, clientsTable, buyingHousesTable, usersTable,
} from "@workspace/db";
import { CreateClientPurchaseOrderBody } from "@workspace/api-zod";
import { getSession } from "@/lib/auth/session";
import { formatPoCode } from "@/lib/po-codes";

export const runtime = "nodejs";

type Row = typeof clientPurchaseOrdersTable.$inferSelect;

export async function mapCpoRow(r: Row) {
  const [client] = await db.select({ name: clientsTable.name, buyingHouseId: clientsTable.buyingHouseId })
    .from(clientsTable).where(eq(clientsTable.id, r.clientId));
  let buyingHouseName: string | null = null;
  if (client?.buyingHouseId != null) {
    const [bh] = await db.select({ name: buyingHousesTable.name })
      .from(buyingHousesTable).where(eq(buyingHousesTable.id, client.buyingHouseId));
    buyingHouseName = bh?.name ?? null;
  }
  let createdByName: string | null = null;
  if (r.createdById != null) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, r.createdById));
    createdByName = u?.name ?? null;
  }
  // `attachments` is the source of truth; fall back to the legacy single
  // columns for rows created before multi-attachment support.
  const attachments = r.attachments?.length
    ? r.attachments
    : r.attachmentUrl
      ? [{ url: r.attachmentUrl, name: r.attachmentName }]
      : [];
  return {
    id: r.id, code: r.code, clientId: r.clientId, clientName: client?.name ?? "—",
    buyingHouseName, attachmentUrl: r.attachmentUrl, attachmentName: r.attachmentName, attachments,
    createdById: r.createdById ?? null, createdByName, createdAt: r.createdAt.toISOString(),
  };
}

async function nextCpoCode(clientId: number): Promise<string> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [{ value }] = await db.select({ value: count() }).from(clientPurchaseOrdersTable)
    .where(and(gte(clientPurchaseOrdersTable.createdAt, monthStart), lt(clientPurchaseOrdersTable.createdAt, monthEnd)));
  const [client] = await db.select({ codePrefix: clientsTable.codePrefix })
    .from(clientsTable).where(eq(clientsTable.id, clientId));
  const prefix = client?.codePrefix?.trim();
  if (!prefix) throw new Error("Set a PO code prefix for this client first");
  return formatPoCode(prefix, now, Number(value) + 1);
}

export async function GET(): Promise<Response> {
  const rows = await db.select().from(clientPurchaseOrdersTable).orderBy(clientPurchaseOrdersTable.createdAt);
  return NextResponse.json(await Promise.all(rows.map(mapCpoRow)));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreateClientPurchaseOrderBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const user = await getSession();
  let code: string;
  try { code = await nextCpoCode(parsed.data.clientId); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 }); }
  const attachments = parsed.data.attachments.map((a) => ({ url: a.url, name: a.name ?? null }));
  const [first] = attachments;
  const [row] = await db.insert(clientPurchaseOrdersTable).values({
    code,
    clientId: parsed.data.clientId,
    attachmentUrl: first.url,
    attachmentName: first.name,
    attachments,
    createdById: user?.sub ?? null,
  }).returning();
  return NextResponse.json(await mapCpoRow(row), { status: 201 });
}
