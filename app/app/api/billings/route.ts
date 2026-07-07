import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import {
  db, billingsTable, billingLinesTable, billingEventItemsTable,
  clientsTable, buyingHousesTable, clientPurchaseOrdersTable, partnersTable,
  usersTable, taxSettingsTable, paymentTermsTable,
} from "@workspace/db";
import { CreateBillingBody } from "@workspace/api-zod";
import { getSession } from "@/lib/auth/session";
import { computeBilling } from "@/lib/compute-billing";

export const runtime = "nodejs";

type BillingRow = typeof billingsTable.$inferSelect;

// Full billing shape used by both list (BillingSummary) and detail (BillingDetail).
export async function mapBilling(b: BillingRow) {
  const [client] = await db.select({
    name: clientsTable.name, buyingHouseId: clientsTable.buyingHouseId, paymentTermsId: clientsTable.paymentTermsId,
  }).from(clientsTable).where(eq(clientsTable.id, b.clientId));
  let buyingHouseName: string | null = null;
  if (client?.buyingHouseId != null) {
    const [bh] = await db.select({ name: buyingHousesTable.name })
      .from(buyingHousesTable).where(eq(buyingHousesTable.id, client.buyingHouseId));
    buyingHouseName = bh?.name ?? null;
  }
  let paymentTerms: string | null = null;
  if (client?.paymentTermsId != null) {
    const [pt] = await db.select({ name: paymentTermsTable.name })
      .from(paymentTermsTable).where(eq(paymentTermsTable.id, client.paymentTermsId));
    paymentTerms = pt?.name ?? null;
  }
  const [cpo] = await db.select({ code: clientPurchaseOrdersTable.code })
    .from(clientPurchaseOrdersTable).where(eq(clientPurchaseOrdersTable.id, b.clientPurchaseOrderId));
  let createdByName: string | null = null;
  if (b.createdById != null) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, b.createdById));
    createdByName = u?.name ?? null;
  }

  const lineRows = await db.select().from(billingLinesTable).where(eq(billingLinesTable.billingId, b.id));
  const lines = [];
  let totalInvoice = 0, netReceivable = 0, netMargin = 0;
  for (const ln of lineRows) {
    const [partner] = await db.select({ name: partnersTable.name }).from(partnersTable).where(eq(partnersTable.id, ln.partnerId));
    const itemRows = await db.select().from(billingEventItemsTable).where(eq(billingEventItemsTable.billingLineId, ln.id));
    const c = computeBilling({
      events: itemRows.map(it => ({
        eventCount: it.eventCount, billableRate: Number(it.billableRate), payoutRate: Number(it.payoutRate),
      })),
      forexSellingRate: Number(b.forexSellingRate), forexBuyingRate: Number(b.forexBuyingRate),
      remittanceTaxPct: Number(b.remittanceTaxPct), salesTaxPct: Number(b.salesTaxPct),
      withholdingTaxPct: Number(b.withholdingTaxPct), bulkDiscountPct: Number(b.bulkDiscountPct),
      whtApplied: b.whtApplied,
    });
    totalInvoice += c.totalInvoice; netReceivable += c.netReceivable; netMargin += c.netMargin;
    lines.push({
      id: ln.id, partnerId: ln.partnerId, partnerName: partner?.name ?? "—",
      partnerPurchaseOrderId: ln.partnerPurchaseOrderId ?? null,
      items: itemRows.map(it => ({
        id: it.id, clientEventId: it.clientEventId, eventName: it.eventName,
        billableRate: Number(it.billableRate), payoutRate: Number(it.payoutRate), eventCount: it.eventCount,
      })),
    });
  }

  return {
    id: b.id, clientId: b.clientId, clientName: client?.name ?? "—", buyingHouseName,
    cpoCode: cpo?.code ?? "—", clientPurchaseOrderId: b.clientPurchaseOrderId,
    period: b.period, status: b.status, invoiceCode: b.invoiceCode ?? null,
    forexSellingRate: Number(b.forexSellingRate), forexBuyingRate: Number(b.forexBuyingRate),
    bulkDiscountPct: Number(b.bulkDiscountPct), whtApplied: b.whtApplied,
    remittanceTaxPct: Number(b.remittanceTaxPct), salesTaxPct: Number(b.salesTaxPct),
    withholdingTaxPct: Number(b.withholdingTaxPct),
    totalInvoice, netReceivable, netMargin,
    notes: b.notes ?? null, createdByName, createdAt: b.createdAt.toISOString(),
    invoiceGeneratedAt: b.invoiceGeneratedAt ? b.invoiceGeneratedAt.toISOString() : null,
    paymentTerms, lines,
  };
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  const period = url.searchParams.get("period");
  const status = url.searchParams.get("status");
  const conds = [];
  if (clientId) conds.push(eq(billingsTable.clientId, Number(clientId)));
  if (period) conds.push(eq(billingsTable.period, period));
  if (status) conds.push(eq(billingsTable.status, status));
  const rows = await db.select().from(billingsTable)
    .where(conds.length ? and(...conds) : undefined).orderBy(billingsTable.createdAt);
  return NextResponse.json(await Promise.all(rows.map(mapBilling)));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreateBillingBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const user = await getSession();

  const [tax] = await db.select().from(taxSettingsTable).limit(1);
  if (!tax) return NextResponse.json({ error: "Tax settings not configured" }, { status: 400 });

  const [billing] = await db.insert(billingsTable).values({
    clientId: parsed.data.clientId,
    clientPurchaseOrderId: parsed.data.clientPurchaseOrderId,
    period: parsed.data.period,
    forexSellingRate: String(parsed.data.forexSellingRate),
    forexBuyingRate: String(parsed.data.forexBuyingRate),
    bulkDiscountPct: String(parsed.data.bulkDiscountPct),
    whtApplied: parsed.data.whtApplied,
    remittanceTaxPct: String(tax.remittanceTaxPct),
    salesTaxPct: String(tax.salesTaxPct),
    withholdingTaxPct: String(tax.withholdingTaxPct),
    status: "pending",
    notes: parsed.data.notes ?? null,
    createdById: user?.sub ?? null,
  }).returning();

  for (const line of parsed.data.lines) {
    const [ln] = await db.insert(billingLinesTable).values({
      billingId: billing.id, partnerId: line.partnerId,
      partnerPurchaseOrderId: line.partnerPurchaseOrderId ?? null,
    }).returning();
    if (line.items.length) {
      await db.insert(billingEventItemsTable).values(line.items.map(it => ({
        billingLineId: ln.id, clientEventId: it.clientEventId, eventName: it.eventName,
        billableRate: String(it.billableRate), payoutRate: String(it.payoutRate), eventCount: it.eventCount,
      })));
    }
  }
  return NextResponse.json(await mapBilling(billing), { status: 201 });
}
