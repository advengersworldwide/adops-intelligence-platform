import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, paymentsTable, paymentBillsTable, billsTable } from "@workspace/db";
import {
  ListPaymentsResponse,
  CreatePaymentBody,
  UpdatePaymentParams,
  UpdatePaymentBody, UpdatePaymentResponse,
  DeletePaymentParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function mapPayment(p: typeof paymentsTable.$inferSelect) {
  const pbRows = await db.select().from(paymentBillsTable)
    .innerJoin(billsTable, eq(paymentBillsTable.billId, billsTable.id))
    .where(eq(paymentBillsTable.paymentId, p.id));
  const allocations = pbRows.map(({ payment_bills: pb, bills: b }) => ({
    billId: pb.billId,
    billNumber: b.billNumber,
    amountApplied: Number(pb.amountApplied),
  }));
  return {
    id: p.id,
    mode: p.mode,
    totalAmount: Number(p.totalAmount),
    notes: p.notes ?? null,
    chequeImageUrl: p.chequeImageUrl ?? null,
    receiptUrl: p.receiptUrl ?? null,
    createdBy: p.createdBy ?? null,
    createdAt: p.createdAt.toISOString(),
    allocations,
  };
}

router.get("/payments", async (req, res): Promise<void> => {
  const rows = await db.select().from(paymentsTable).orderBy(paymentsTable.createdAt);
  const mapped = await Promise.all(rows.map(mapPayment));
  res.json(ListPaymentsResponse.parse(mapped));
});

router.post("/payments", async (req, res): Promise<void> => {
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const totalAmount = parsed.data.allocations.reduce((s, a) => s + a.amountApplied, 0);
    const [payment] = await db.insert(paymentsTable).values({
      mode: parsed.data.mode,
      totalAmount: String(totalAmount),
      notes: parsed.data.notes ?? null,
      chequeImageUrl: parsed.data.chequeImageUrl ?? null,
      receiptUrl: parsed.data.receiptUrl ?? null,
    }).returning();
    if (parsed.data.allocations.length > 0) {
      await db.insert(paymentBillsTable).values(
        parsed.data.allocations.map(a => ({
          paymentId: payment.id,
          billId: a.billId,
          amountApplied: String(a.amountApplied),
        }))
      );
    }
    res.status(201).json(UpdatePaymentResponse.parse(await mapPayment(payment)));
  } catch (err) {
    console.error("[payments POST]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create payment" });
  }
});

router.patch("/payments/:id", async (req, res): Promise<void> => {
  const params = UpdatePaymentParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdatePaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const totalAmount = parsed.data.allocations.reduce((s, a) => s + a.amountApplied, 0);
    const [payment] = await db.update(paymentsTable).set({
      mode: parsed.data.mode,
      totalAmount: String(totalAmount),
      notes: parsed.data.notes ?? null,
      chequeImageUrl: parsed.data.chequeImageUrl ?? null,
      receiptUrl: parsed.data.receiptUrl ?? null,
    }).where(eq(paymentsTable.id, params.data.id)).returning();
    if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }
    await db.delete(paymentBillsTable).where(eq(paymentBillsTable.paymentId, payment.id));
    if (parsed.data.allocations.length > 0) {
      await db.insert(paymentBillsTable).values(
        parsed.data.allocations.map(a => ({
          paymentId: payment.id,
          billId: a.billId,
          amountApplied: String(a.amountApplied),
        }))
      );
    }
    res.json(UpdatePaymentResponse.parse(await mapPayment(payment)));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update payment" });
  }
});

router.delete("/payments/:id", async (req, res): Promise<void> => {
  const params = DeletePaymentParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(paymentsTable).where(eq(paymentsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Payment not found" }); return; }
  res.sendStatus(204);
});

export default router;
