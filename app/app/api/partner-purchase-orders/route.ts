import { NextResponse } from "next/server";
import { eq, and, gte, lt, count } from "drizzle-orm";
import {
  db, partnerPurchaseOrdersTable, partnerPurchaseOrderItemsTable, partnersTable,
  clientPurchaseOrdersTable, clientsTable, buyingHousesTable, usersTable, paymentTermsTable,
} from "@workspace/db";
import { CreatePartnerPurchaseOrderBody } from "@workspace/api-zod";
import { getSession } from "@/lib/auth/session";
import { formatPoCode } from "@/lib/po-codes";
import { lineBudget, totalBudget } from "@/lib/po-totals";

export const runtime = "nodejs";

type Row = typeof partnerPurchaseOrdersTable.$inferSelect;

export async function mapPpoRow(r: Row) {
  const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, r.partnerId));
  const [cpo] = await db.select().from(clientPurchaseOrdersTable).where(eq(clientPurchaseOrdersTable.id, r.clientPurchaseOrderId));
  const [client] = cpo ? await db.select({ id: clientsTable.id, name: clientsTable.name, buyingHouseId: clientsTable.buyingHouseId })
    .from(clientsTable).where(eq(clientsTable.id, cpo.clientId)) : [undefined];
  let buyingHouseName: string | null = null;
  if (client?.buyingHouseId != null) {
    const [bh] = await db.select({ name: buyingHousesTable.name }).from(buyingHousesTable).where(eq(buyingHousesTable.id, client.buyingHouseId));
    buyingHouseName = bh?.name ?? null;
  }
  let createdByName: string | null = null;
  if (r.createdById != null) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, r.createdById));
    createdByName = u?.name ?? null;
  }
  let paymentTermName: string | null = null;
  if (partner?.paymentTermsId != null) {
    const [pt] = await db.select({ name: paymentTermsTable.name }).from(paymentTermsTable)
      .where(eq(paymentTermsTable.id, partner.paymentTermsId));
    paymentTermName = pt?.name ?? null;
  }
  const itemRows = await db.select().from(partnerPurchaseOrderItemsTable)
    .where(eq(partnerPurchaseOrderItemsTable.partnerPurchaseOrderId, r.id));
  return {
    id: r.id, code: r.code, partnerId: r.partnerId, partnerName: partner?.name ?? "—",
    clientPurchaseOrderId: r.clientPurchaseOrderId, cpoCode: cpo?.code ?? "—",
    clientId: client?.id ?? 0, clientName: client?.name ?? "—", buyingHouseName,
    startDate: r.startDate, endDate: r.endDate, totalBudget: Number(r.totalBudget),
    notes: r.notes ?? null,
    createdById: r.createdById ?? null, createdByName, createdAt: r.createdAt.toISOString(),
    partner: partner ? mapPartnerKyc(partner, paymentTermName) : undefined,
    items: itemRows.map(it => ({
      id: it.id, clientEventId: it.clientEventId, eventName: it.eventName,
      cacRate: Number(it.cacRate), eventCount: it.eventCount, lineBudget: Number(it.lineBudget),
    })),
  };
}

function mapPartnerKyc(p: typeof partnersTable.$inferSelect, paymentTermName: string | null) {
  return {
    id: p.id, name: p.name, address: p.address, pocName: p.pocName, pocNumber: p.pocNumber,
    pocEmail: p.pocEmail, companyEmail: p.companyEmail, companyNumber: p.companyNumber,
    bankName: p.bankName, bankAccountNumber: p.bankAccountNumber, bankAddress: p.bankAddress,
    swiftCode: p.swiftCode, iban: p.iban, salesTaxNumber: p.salesTaxNumber, ntnNumber: p.ntnNumber,
    paymentTermsId: p.paymentTermsId ?? null, paymentTermName,
    createdAt: p.createdAt.toISOString(),
  };
}

async function nextPpoCode(partnerId: number): Promise<string> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [{ value }] = await db.select({ value: count() }).from(partnerPurchaseOrdersTable)
    .where(and(gte(partnerPurchaseOrdersTable.createdAt, monthStart), lt(partnerPurchaseOrdersTable.createdAt, monthEnd)));
  const [partner] = await db.select({ codePrefix: partnersTable.codePrefix })
    .from(partnersTable).where(eq(partnersTable.id, partnerId));
  const prefix = partner?.codePrefix?.trim();
  if (!prefix) throw new Error("Set a PO code prefix for this partner first");
  return formatPoCode(prefix, now, Number(value) + 1);
}

export async function GET(): Promise<Response> {
  const rows = await db.select().from(partnerPurchaseOrdersTable).orderBy(partnerPurchaseOrdersTable.createdAt);
  return NextResponse.json(await Promise.all(rows.map(mapPpoRow)));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreatePartnerPurchaseOrderBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { partnerId, clientPurchaseOrderId, startDate, endDate, items, notes } = parsed.data;
  const user = await getSession();
  const total = totalBudget(items.map(i => ({ cacRate: i.cacRate, eventCount: i.eventCount })));

  let code: string;
  try { code = await nextPpoCode(partnerId); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 }); }

  const [ppo] = await db.insert(partnerPurchaseOrdersTable).values({
    code, partnerId, clientPurchaseOrderId, startDate, endDate,
    totalBudget: String(total), notes: notes ?? null, createdById: user?.sub ?? null,
  }).returning();

  await db.insert(partnerPurchaseOrderItemsTable).values(items.map(i => ({
    partnerPurchaseOrderId: ppo.id, clientEventId: i.clientEventId, eventName: i.eventName,
    cacRate: String(i.cacRate), eventCount: i.eventCount,
    lineBudget: String(lineBudget(i.cacRate, i.eventCount)),
  })));

  return NextResponse.json(await mapPpoRow(ppo), { status: 201 });
}
