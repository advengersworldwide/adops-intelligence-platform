import { NextResponse } from "next/server";
import { and, count, eq, gte, lt } from "drizzle-orm";
import {
  db, partnerBillsTable, partnersTable, clientsTable, partnerPurchaseOrdersTable,
  paymentTermsTable, usersTable, partnerPaymentsTable,
} from "@workspace/db";
import { CreatePartnerBillBody } from "@workspace/api-zod";
import { getSession } from "@/lib/auth/session";
import { formatPoCode } from "@/lib/po-codes";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

type Row = typeof partnerBillsTable.$inferSelect;

export async function mapPartnerBill(r: Row) {
  const [partner] = await db.select({ name: partnersTable.name, codePrefix: partnersTable.codePrefix, paymentTermsId: partnersTable.paymentTermsId })
    .from(partnersTable).where(eq(partnersTable.id, r.partnerId));
  const client = r.clientId
    ? (await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, r.clientId)))[0]
    : null;
  const ppo = r.partnerPurchaseOrderId
    ? (await db.select({ code: partnerPurchaseOrdersTable.code }).from(partnerPurchaseOrdersTable).where(eq(partnerPurchaseOrdersTable.id, r.partnerPurchaseOrderId)))[0]
    : null;
  let partnerTermDays: number | null = null;
  if (partner?.paymentTermsId != null) {
    const [pt] = await db.select({ days: paymentTermsTable.days }).from(paymentTermsTable).where(eq(paymentTermsTable.id, partner.paymentTermsId));
    partnerTermDays = pt?.days ?? null;
  }
  let createdByName: string | null = null;
  if (r.createdById != null) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, r.createdById));
    createdByName = u?.name ?? null;
  }
  const paidRows = await db.select({ amt: partnerPaymentsTable.amount }).from(partnerPaymentsTable)
    .where(and(eq(partnerPaymentsTable.partnerBillId, r.id), eq(partnerPaymentsTable.status, "settled")));
  const amountPaid = paidRows.reduce((s, x) => s + Number(x.amt), 0);
  return {
    id: r.id, code: r.code, partnerInvoiceNumber: r.partnerInvoiceNumber ?? null,
    partnerId: r.partnerId, partnerName: partner?.name ?? "—",
    clientId: r.clientId ?? null, clientName: client?.name ?? null,
    partnerPurchaseOrderId: r.partnerPurchaseOrderId ?? null, ppoCode: ppo?.code ?? null,
    amount: Number(r.amount), amountPaid, attachmentUrl: r.attachmentUrl ?? null, attachmentName: r.attachmentName ?? null,
    dateReceived: r.dateReceived ?? null, partnerTermDays, notes: r.notes ?? null,
    createdByName, createdAt: r.createdAt.toISOString(),
  };
}

async function nextPbillCode(partnerId: number): Promise<string> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [{ value }] = await db.select({ value: count() }).from(partnerBillsTable)
    .where(and(gte(partnerBillsTable.createdAt, monthStart), lt(partnerBillsTable.createdAt, monthEnd)));
  const [partner] = await db.select({ codePrefix: partnersTable.codePrefix }).from(partnersTable).where(eq(partnersTable.id, partnerId));
  const prefix = partner?.codePrefix?.trim();
  if (!prefix) throw new Error("Set a code prefix on the partner first");
  return "PBILL-" + formatPoCode(prefix, now, Number(value) + 1);
}

export async function GET(): Promise<Response> {
  const auth = await requirePermission("billings:view");
  if (isAuthError(auth)) return auth;
  const rows = await db.select().from(partnerBillsTable).orderBy(partnerBillsTable.createdAt);
  return NextResponse.json(await Promise.all(rows.map(mapPartnerBill)));
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requirePermission("billings:edit");
  if (isAuthError(auth)) return auth;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreatePartnerBillBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const user = await getSession();
  let code: string;
  try { code = await nextPbillCode(parsed.data.partnerId); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 }); }
  const [row] = await db.insert(partnerBillsTable).values({
    code,
    partnerInvoiceNumber: parsed.data.partnerInvoiceNumber ?? null,
    partnerId: parsed.data.partnerId,
    clientId: parsed.data.clientId ?? null,
    partnerPurchaseOrderId: parsed.data.partnerPurchaseOrderId ?? null,
    amount: String(parsed.data.amount),
    attachmentUrl: parsed.data.attachmentUrl ?? null,
    attachmentName: parsed.data.attachmentName ?? null,
    dateReceived: parsed.data.dateReceived ?? null,
    notes: parsed.data.notes ?? null,
    createdById: user?.sub ?? null,
  }).returning();
  return NextResponse.json(await mapPartnerBill(row), { status: 201 });
}
