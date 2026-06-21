import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, transactionsTable, campaignsTable } from "@workspace/db";
import { UploadDataBody, UploadDataResponse } from "@workspace/api-zod";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UploadDataBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  let imported = 0, skipped = 0;
  const errors: string[] = [];

  for (const row of parsed.data.rows) {
    try {
      const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.name, row.campaignName));
      if (!campaign) { skipped++; errors.push(`Campaign not found: "${row.campaignName}"`); continue; }
      const spend = row.spend, cost = row.cost, profit = spend - cost;
      await db.insert(transactionsTable).values({ campaignId: campaign.id, date: row.date, spend: String(spend), cost: String(cost), profit: String(profit) });
      imported++;
    } catch (err) {
      skipped++; errors.push(`Error processing row for "${row.campaignName}": ${String(err)}`);
    }
  }

  return NextResponse.json(UploadDataResponse.parse({ imported, skipped, errors }));
}
