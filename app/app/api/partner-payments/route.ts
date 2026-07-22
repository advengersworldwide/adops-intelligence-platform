import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import {
  db, partnerPaymentsTable, partnerBillsTable, partnersTable, clientsTable, paymentsTable, usersTable,
} from "@workspace/db";
import { CreatePartnerPaymentBody } from "@workspace/api-zod";
import { getSession } from "@/lib/auth/session";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

type Row = typeof partnerPaymentsTable.$inferSelect;

function fmtUsd(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export async function mapPartnerPayment(r: Row) {
  const [partner] = await db.select({ name: partnersTable.name }).from(partnersTable).where(eq(partnersTable.id, r.partnerId));
  const [bill] = await db.select({ code: partnerBillsTable.code, clientId: partnerBillsTable.clientId })
    .from(partnerBillsTable).where(eq(partnerBillsTable.id, r.partnerBillId));
  const client = bill?.clientId
    ? (await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, bill.clientId)))[0]
    : null;
  let sourceClientPaymentLabel: string | null = null;
  if (r.sourceClientPaymentId != null) {
    const [src] = await db.select({ id: paymentsTable.id, total: paymentsTable.totalAmount, date: paymentsTable.paymentDate })
      .from(paymentsTable).where(eq(paymentsTable.id, r.sourceClientPaymentId));
    if (src) sourceClientPaymentLabel = `#${src.id} · PKR ${fmtUsd(Number(src.total))}${src.date ? " · " + src.date : ""}`;
  }
  let createdByName: string | null = null;
  if (r.createdById != null) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, r.createdById));
    createdByName = u?.name ?? null;
  }
  return {
    id: r.id, partnerId: r.partnerId, partnerName: partner?.name ?? "—",
    partnerBillId: r.partnerBillId, partnerBillCode: bill?.code ?? "—",
    clientId: bill?.clientId ?? null, clientName: client?.name ?? null,
    sourceClientPaymentId: r.sourceClientPaymentId ?? null, sourceClientPaymentLabel,
    amount: Number(r.amount), mode: r.mode ?? null, status: r.status,
    paymentDate: r.paymentDate ?? null, attachmentUrl: r.attachmentUrl ?? null,
    notes: r.notes ?? null, createdByName, createdAt: r.createdAt.toISOString(),
  };
}

// Remaining USD that can still be allocated to a bill: bill.amount − Σ(all partner payments to it),
// optionally excluding one payment id (when editing that payment). Matches the client rule where
// over-allocation validation counts ALL allocations (pending + settled) so two payments can't
// jointly over-promise a bill, while paid/progress/aging count only settled.
export async function billRemaining(partnerBillId: number, excludePaymentId?: number): Promise<{ amount: number; remaining: number } | null> {
  const [bill] = await db.select({ amount: partnerBillsTable.amount }).from(partnerBillsTable).where(eq(partnerBillsTable.id, partnerBillId));
  if (!bill) return null;
  const rows = await db.select({ amt: partnerPaymentsTable.amount }).from(partnerPaymentsTable)
    .where(excludePaymentId != null
      ? and(eq(partnerPaymentsTable.partnerBillId, partnerBillId), ne(partnerPaymentsTable.id, excludePaymentId))
      : eq(partnerPaymentsTable.partnerBillId, partnerBillId));
  const allocated = rows.reduce((s, x) => s + Number(x.amt), 0);
  return { amount: Number(bill.amount), remaining: Number(bill.amount) - allocated };
}

// Validate the funding client payment exists and is `received`. Returns an error string or null.
export async function validateSource(sourceClientPaymentId: number | null | undefined): Promise<string | null> {
  if (sourceClientPaymentId == null) return null;
  const [src] = await db.select({ status: paymentsTable.status }).from(paymentsTable).where(eq(paymentsTable.id, sourceClientPaymentId));
  if (!src) return "Funding client payment not found";
  if (src.status !== "received") return "Funding client payment must be received first";
  return null;
}

export async function GET(): Promise<Response> {
  const auth = await requirePermission("payments:view");
  if (isAuthError(auth)) return auth;
  const rows = await db.select().from(partnerPaymentsTable).orderBy(partnerPaymentsTable.createdAt);
  return NextResponse.json(await Promise.all(rows.map(mapPartnerPayment)));
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requirePermission("payments:edit");
  if (isAuthError(auth)) return auth;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreatePartnerPaymentBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const [bill] = await db.select({ partnerId: partnerBillsTable.partnerId }).from(partnerBillsTable).where(eq(partnerBillsTable.id, parsed.data.partnerBillId));
  if (!bill) return NextResponse.json({ error: "Partner bill not found" }, { status: 400 });

  const srcErr = await validateSource(parsed.data.sourceClientPaymentId);
  if (srcErr) return NextResponse.json({ error: srcErr }, { status: 400 });

  const rem = await billRemaining(parsed.data.partnerBillId);
  if (!rem) return NextResponse.json({ error: "Partner bill not found" }, { status: 400 });
  if (parsed.data.amount > rem.remaining + 0.01) {
    return NextResponse.json({ error: `Amount exceeds remaining USD ${rem.remaining.toFixed(2)} on this bill` }, { status: 400 });
  }

  const user = await getSession();
  const [row] = await db.insert(partnerPaymentsTable).values({
    partnerId: bill.partnerId,
    partnerBillId: parsed.data.partnerBillId,
    sourceClientPaymentId: parsed.data.sourceClientPaymentId ?? null,
    amount: String(parsed.data.amount),
    mode: parsed.data.mode ?? null,
    status: parsed.data.status ?? "pending",
    attachmentUrl: parsed.data.attachmentUrl ?? null,
    paymentDate: parsed.data.paymentDate ?? null,
    notes: parsed.data.notes ?? null,
    createdById: user?.sub ?? null,
  }).returning();
  return NextResponse.json(await mapPartnerPayment(row), { status: 201 });
}
