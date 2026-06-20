import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db, billsTable, billTransactionsTable, billingRecordsTable,
  paymentBillsTable, clientsTable, buyingHousesTable, costModelsTable, partnersTable,
} from "@workspace/db";
import { computeRow } from "../lib/computeRow";
import {
  ListBillsQueryParams, ListBillsResponse,
  CreateBillBody,
  GetBillParams, GetBillResponse,
  UpdateBillBody, UpdateBillResponse,
  DeleteBillParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function generateBillNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(billsTable)
    .where(sql`extract(year from created_at) = ${year}`);
  const seq = (Number(count) + 1).toString().padStart(4, "0");
  return `INV-${year}-${seq}`;
}

async function calcBillTotals(billId: number) {
  const txRows = await db
    .select()
    .from(billTransactionsTable)
    .innerJoin(billingRecordsTable, eq(billTransactionsTable.billingRecordId, billingRecordsTable.id))
    .where(eq(billTransactionsTable.billId, billId));

  let totalReceivable = 0;
  for (const { billing_records: r } of txRows) {
    totalReceivable += computeRow(r).receivablePkr;
  }

  const paidRows = await db.select({ amt: paymentBillsTable.amountApplied })
    .from(paymentBillsTable).where(eq(paymentBillsTable.billId, billId));
  const totalPaid = paidRows.reduce((s, r) => s + Number(r.amt), 0);

  return { totalReceivable, totalPaid, totalPending: totalReceivable - totalPaid };
}

async function mapBillSummary(bill: typeof billsTable.$inferSelect) {
  const totals = await calcBillTotals(bill.id);
  const txCount = await db.select({ cnt: sql<number>`count(*)` })
    .from(billTransactionsTable).where(eq(billTransactionsTable.billId, bill.id));
  const client = bill.clientId
    ? (await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, bill.clientId)))[0]
    : null;
  const bh = bill.buyingHouseId
    ? (await db.select({ name: buyingHousesTable.name }).from(buyingHousesTable).where(eq(buyingHousesTable.id, bill.buyingHouseId)))[0]
    : null;
  const status = totals.totalPaid <= 0 ? "outstanding"
    : totals.totalPending <= 0 ? "paid" : "partial";
  return {
    id: bill.id,
    billNumber: bill.billNumber,
    clientId: bill.clientId ?? null,
    clientName: client?.name ?? null,
    buyingHouseId: bill.buyingHouseId ?? null,
    buyingHouseName: bh?.name ?? null,
    status,
    totalReceivable: totals.totalReceivable,
    totalPaid: totals.totalPaid,
    totalPending: totals.totalPending,
    transactionCount: Number(txCount[0].cnt),
    notes: bill.notes ?? null,
    createdBy: bill.createdBy ?? null,
    createdAt: bill.createdAt.toISOString(),
  };
}

async function mapBillDetail(bill: typeof billsTable.$inferSelect) {
  const summary = await mapBillSummary(bill);
  const txRows = await db
    .select()
    .from(billTransactionsTable)
    .innerJoin(billingRecordsTable, eq(billTransactionsTable.billingRecordId, billingRecordsTable.id))
    .where(eq(billTransactionsTable.billId, bill.id));

  const transactions = await Promise.all(txRows.map(async ({ billing_records: r }) => {
    const bh = await db.select({ name: buyingHousesTable.name }).from(buyingHousesTable).where(eq(buyingHousesTable.id, r.buyingHouseId));
    const cm = await db.select().from(costModelsTable).where(eq(costModelsTable.id, r.costModelId));
    const cl = r.clientId ? (await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, r.clientId)))[0] : null;
    return {
      id: r.id, platformId: r.platformId, buyingHouseId: r.buyingHouseId,
      buyingHouseName: bh[0]?.name ?? null, clientId: r.clientId ?? null,
      clientName: cl?.name ?? null, costModelId: r.costModelId,
      costModelName: cm[0]?.name ?? null,
      costModelPayoutRate: null,
      costModelMarginPct: null,
      period: r.period, appsflyerPins: r.appsflyerPins, fraudPins: r.fraudPins,
      payoutRate: Number(r.payoutRate), marginPct: Number(r.marginPct),
      forexSellingRate: Number(r.forexSellingRate), forexBuyingRate: Number(r.forexBuyingRate),
      salesTaxPct: Number(r.salesTaxPct), remittanceTaxPct: Number(r.remittanceTaxPct),
      withholdingTaxPct: Number(r.withholdingTaxPct), bulkDiscountPct: Number(r.bulkDiscountPct),
      platformBulkDiscountPct: Number(r.platformBulkDiscountPct),
      createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
    };
  }));

  const pbRows = await db.select().from(paymentBillsTable).where(eq(paymentBillsTable.billId, bill.id));
  const payments = pbRows.map(pb => ({ paymentId: pb.paymentId, amountApplied: Number(pb.amountApplied) }));

  return { ...summary, transactions, payments };
}

router.get("/bills", async (req, res): Promise<void> => {
  const query = ListBillsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const conditions = [];
  if (query.data.clientId != null) conditions.push(eq(billsTable.clientId, query.data.clientId));
  if (query.data.buyingHouseId != null) conditions.push(eq(billsTable.buyingHouseId, query.data.buyingHouseId));
  const rows = await db.select().from(billsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(billsTable.createdAt);
  const mapped = await Promise.all(rows.map(mapBillSummary));
  res.json(ListBillsResponse.parse(mapped));
});

router.post("/bills", async (req, res): Promise<void> => {
  const parsed = CreateBillBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const billNumber = await generateBillNumber();
    const [bill] = await db.insert(billsTable).values({
      billNumber,
      clientId: parsed.data.clientId ?? null,
      buyingHouseId: parsed.data.buyingHouseId ?? null,
      notes: parsed.data.notes ?? null,
      status: "outstanding",
    }).returning();
    if (parsed.data.billingRecordIds.length > 0) {
      await db.insert(billTransactionsTable).values(
        parsed.data.billingRecordIds.map(rid => ({ billId: bill.id, billingRecordId: rid }))
      );
    }
    res.status(201).json(GetBillResponse.parse(await mapBillDetail(bill)));
  } catch (err) {
    console.error("[bills POST]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create bill" });
  }
});

router.get("/bills/:id", async (req, res): Promise<void> => {
  const params = GetBillParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, params.data.id));
  if (!bill) { res.status(404).json({ error: "Bill not found" }); return; }
  res.json(GetBillResponse.parse(await mapBillDetail(bill)));
});

router.patch("/bills/:id", async (req, res): Promise<void> => {
  const params = GetBillParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateBillBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const [bill] = await db.update(billsTable).set({
      clientId: parsed.data.clientId ?? null,
      buyingHouseId: parsed.data.buyingHouseId ?? null,
      notes: parsed.data.notes ?? null,
    }).where(eq(billsTable.id, params.data.id)).returning();
    if (!bill) { res.status(404).json({ error: "Bill not found" }); return; }
    if (parsed.data.billingRecordIds) {
      await db.delete(billTransactionsTable).where(eq(billTransactionsTable.billId, bill.id));
      if (parsed.data.billingRecordIds.length > 0) {
        await db.insert(billTransactionsTable).values(
          parsed.data.billingRecordIds.map(rid => ({ billId: bill.id, billingRecordId: rid }))
        );
      }
    }
    res.json(UpdateBillResponse.parse(await mapBillDetail(bill)));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update bill" });
  }
});

router.delete("/bills/:id", async (req, res): Promise<void> => {
  const params = DeleteBillParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(billsTable).where(eq(billsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Bill not found" }); return; }
  res.sendStatus(204);
});

export default router;
