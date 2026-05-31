import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, transactionsTable, campaignsTable } from "@workspace/db";
import { UploadDataBody, UploadDataResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/upload", async (req, res): Promise<void> => {
  const parsed = UploadDataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of parsed.data.rows) {
    try {
      // Look up campaign by name
      const [campaign] = await db
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.name, row.campaignName));

      if (!campaign) {
        skipped++;
        errors.push(`Campaign not found: "${row.campaignName}"`);
        continue;
      }

      const spend = row.spend;
      const cost = row.cost;
      const profit = spend - cost;

      await db.insert(transactionsTable).values({
        campaignId: campaign.id,
        date: row.date,
        spend: String(spend),
        cost: String(cost),
        profit: String(profit),
      });

      imported++;
    } catch (err) {
      skipped++;
      errors.push(`Error processing row for "${row.campaignName}": ${String(err)}`);
    }
  }

  res.json(UploadDataResponse.parse({ imported, skipped, errors }));
});

export default router;
