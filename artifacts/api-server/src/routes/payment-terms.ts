import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, paymentTermsTable } from "@workspace/db";
import {
  CreatePaymentTermBody,
  DeletePaymentTermParams,
  ListPaymentTermsResponse,
  ListPaymentTermsResponseItem,
} from "@workspace/api-zod";

const router: IRouter = Router();

function mapRow(r: typeof paymentTermsTable.$inferSelect) {
  return { id: r.id, name: r.name, createdAt: r.createdAt.toISOString() };
}

router.get("/payment-terms", async (_req, res): Promise<void> => {
  const rows = await db.select().from(paymentTermsTable).orderBy(paymentTermsTable.createdAt);
  res.json(ListPaymentTermsResponse.parse(rows.map(mapRow)));
});

router.post("/payment-terms", async (req, res): Promise<void> => {
  const parsed = CreatePaymentTermBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(paymentTermsTable).values({ name: parsed.data.name }).returning();
  res.status(201).json(ListPaymentTermsResponseItem.parse(mapRow(row)));
});

router.delete("/payment-terms/:id", async (req, res): Promise<void> => {
  const params = DeletePaymentTermParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(paymentTermsTable).where(eq(paymentTermsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Payment term not found" }); return; }
  res.sendStatus(204);
});

export default router;
