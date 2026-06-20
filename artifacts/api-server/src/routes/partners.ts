import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, partnersTable, paymentTermsTable } from "@workspace/db";
import {
  CreatePartnerBody,
  UpdatePartnerBody,
  UpdatePartnerParams,
  GetPartnerParams,
  DeletePartnerParams,
  ListPartnersResponse,
  GetPartnerResponse,
  UpdatePartnerResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function mapRow(r: typeof partnersTable.$inferSelect) {
  const [pt] = r.paymentTermsId
    ? await db.select({ name: paymentTermsTable.name }).from(paymentTermsTable)
        .where(eq(paymentTermsTable.id, r.paymentTermsId))
    : [];

  return {
    id: r.id,
    name: r.name,
    address: r.address,
    pocName: r.pocName,
    pocNumber: r.pocNumber,
    pocEmail: r.pocEmail,
    companyEmail: r.companyEmail,
    companyNumber: r.companyNumber,
    bankName: r.bankName,
    bankAccountNumber: r.bankAccountNumber,
    bankAddress: r.bankAddress,
    swiftCode: r.swiftCode,
    iban: r.iban,
    salesTaxNumber: r.salesTaxNumber,
    ntnNumber: r.ntnNumber,
    paymentTermsId: r.paymentTermsId ?? null,
    paymentTermName: pt?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/partners", async (req, res): Promise<void> => {
  const rows = await db.select().from(partnersTable).orderBy(partnersTable.createdAt);
  const mapped = await Promise.all(rows.map(mapRow));
  res.json(ListPartnersResponse.parse(mapped));
});

router.post("/partners", async (req, res): Promise<void> => {
  const parsed = CreatePartnerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(partnersTable).values(parsed.data).returning();
  res.status(201).json(GetPartnerResponse.parse(await mapRow(row)));
});

router.get("/partners/:id", async (req, res): Promise<void> => {
  const params = GetPartnerParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(partnersTable).where(eq(partnersTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Partner not found" });
    return;
  }
  res.json(GetPartnerResponse.parse(await mapRow(row)));
});

router.patch("/partners/:id", async (req, res): Promise<void> => {
  const params = UpdatePartnerParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePartnerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(partnersTable)
    .set(parsed.data)
    .where(eq(partnersTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Partner not found" });
    return;
  }
  res.json(UpdatePartnerResponse.parse(await mapRow(row)));
});

router.delete("/partners/:id", async (req, res): Promise<void> => {
  const params = DeletePartnerParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(partnersTable)
    .where(eq(partnersTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Partner not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
