import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, transactionsTable, campaignsTable, clientsTable, partnersTable } from "@workspace/db";
import { GetAlertsResponse } from "@workspace/api-zod";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const rows = await db.select({
    campaignId: campaignsTable.id, campaignName: campaignsTable.name,
    clientName: clientsTable.name, platformName: partnersTable.name,
    totalSpend: sql<string>`coalesce(sum(${transactionsTable.spend}), 0)`,
    totalProfit: sql<string>`coalesce(sum(${transactionsTable.profit}), 0)`,
  }).from(campaignsTable)
    .leftJoin(clientsTable, eq(clientsTable.id, campaignsTable.clientId))
    .leftJoin(partnersTable, eq(partnersTable.id, campaignsTable.platformId))
    .leftJoin(transactionsTable, eq(transactionsTable.campaignId, campaignsTable.id))
    .groupBy(campaignsTable.id, campaignsTable.name, clientsTable.name, partnersTable.name)
    .having(sql`count(${transactionsTable.id}) > 0`);

  const alerts: Array<{
    id: string; type: "negative_profit" | "low_margin"; severity: "warning" | "critical";
    message: string; campaignId: number; campaignName: string;
    clientName: string | null; platformName: string | null; value: number | null;
  }> = [];

  for (const row of rows) {
    const spend = parseFloat(row.totalSpend ?? "0");
    const profit = parseFloat(row.totalProfit ?? "0");
    const margin = spend > 0 ? (profit / spend) * 100 : 0;
    if (profit < 0) {
      alerts.push({ id: `neg-${row.campaignId}`, type: "negative_profit", severity: "critical", message: `Campaign "${row.campaignName}" has negative profit of $${Math.abs(profit).toFixed(2)}`, campaignId: row.campaignId, campaignName: row.campaignName, clientName: row.clientName ?? null, platformName: row.platformName ?? null, value: profit });
    } else if (margin < 10) {
      alerts.push({ id: `low-${row.campaignId}`, type: "low_margin", severity: "warning", message: `Campaign "${row.campaignName}" has low margin of ${margin.toFixed(1)}%`, campaignId: row.campaignId, campaignName: row.campaignName, clientName: row.clientName ?? null, platformName: row.platformName ?? null, value: margin });
    }
  }

  return NextResponse.json(GetAlertsResponse.parse(alerts));
}
