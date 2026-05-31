import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db, transactionsTable, campaignsTable, clientsTable, platformsTable } from "@workspace/db";
import {
  GetDashboardSummaryQueryParams,
  GetProfitOverTimeQueryParams,
  GetAnalyticsByClientQueryParams,
  GetAnalyticsByPlatformQueryParams,
  GetDashboardSummaryResponse,
  GetProfitOverTimeResponse,
  GetAnalyticsByClientResponse,
  GetAnalyticsByPlatformResponse,
  GetAlertsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function buildDateConditions(dateFrom?: string | null, dateTo?: string | null) {
  const conds = [];
  if (dateFrom) conds.push(gte(transactionsTable.date, dateFrom));
  if (dateTo) conds.push(lte(transactionsTable.date, dateTo));
  return conds;
}

router.get("/analytics/dashboard", async (req, res): Promise<void> => {
  const qp = GetDashboardSummaryQueryParams.safeParse(req.query);
  if (!qp.success) {
    res.status(400).json({ error: qp.error.message });
    return;
  }

  const conditions = buildDateConditions(qp.data.dateFrom, qp.data.dateTo);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [agg] = await db
    .select({
      totalRevenue: sql<string>`coalesce(sum(${transactionsTable.spend}), 0)`,
      totalCost: sql<string>`coalesce(sum(${transactionsTable.cost}), 0)`,
      totalProfit: sql<string>`coalesce(sum(${transactionsTable.profit}), 0)`,
      transactionCount: sql<number>`count(*)::int`,
    })
    .from(transactionsTable)
    .where(whereClause);

  const [counts] = await db
    .select({
      clientCount: sql<number>`count(distinct ${clientsTable.id})::int`,
      platformCount: sql<number>`count(distinct ${platformsTable.id})::int`,
      campaignCount: sql<number>`count(distinct ${campaignsTable.id})::int`,
    })
    .from(clientsTable)
    .leftJoin(campaignsTable, eq(campaignsTable.clientId, clientsTable.id))
    .leftJoin(platformsTable, eq(platformsTable.id, campaignsTable.platformId));

  const totalRevenue = parseFloat(agg?.totalRevenue ?? "0");
  const totalCost = parseFloat(agg?.totalCost ?? "0");
  const totalProfit = parseFloat(agg?.totalProfit ?? "0");
  const marginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  res.json(GetDashboardSummaryResponse.parse({
    totalRevenue,
    totalCost,
    totalProfit,
    marginPct,
    clientCount: counts?.clientCount ?? 0,
    platformCount: counts?.platformCount ?? 0,
    campaignCount: counts?.campaignCount ?? 0,
    transactionCount: agg?.transactionCount ?? 0,
    revenueChange: null,
    profitChange: null,
    costChange: null,
  }));
});

router.get("/analytics/profit-over-time", async (req, res): Promise<void> => {
  const qp = GetProfitOverTimeQueryParams.safeParse(req.query);
  if (!qp.success) {
    res.status(400).json({ error: qp.error.message });
    return;
  }

  const conditions = buildDateConditions(qp.data.dateFrom, qp.data.dateTo);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      date: transactionsTable.date,
      revenue: sql<string>`sum(${transactionsTable.spend})`,
      cost: sql<string>`sum(${transactionsTable.cost})`,
      profit: sql<string>`sum(${transactionsTable.profit})`,
    })
    .from(transactionsTable)
    .where(whereClause)
    .groupBy(transactionsTable.date)
    .orderBy(transactionsTable.date);

  res.json(GetProfitOverTimeResponse.parse(rows.map(r => ({
    date: r.date,
    revenue: parseFloat(r.revenue ?? "0"),
    cost: parseFloat(r.cost ?? "0"),
    profit: parseFloat(r.profit ?? "0"),
  }))));
});

router.get("/analytics/by-client", async (req, res): Promise<void> => {
  const qp = GetAnalyticsByClientQueryParams.safeParse(req.query);
  if (!qp.success) {
    res.status(400).json({ error: qp.error.message });
    return;
  }

  const conditions = buildDateConditions(qp.data.dateFrom, qp.data.dateTo);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      clientId: clientsTable.id,
      clientName: clientsTable.name,
      buyingHouse: clientsTable.buyingHouse,
      revenue: sql<string>`coalesce(sum(${transactionsTable.spend}), 0)`,
      cost: sql<string>`coalesce(sum(${transactionsTable.cost}), 0)`,
      profit: sql<string>`coalesce(sum(${transactionsTable.profit}), 0)`,
      transactionCount: sql<number>`count(${transactionsTable.id})::int`,
    })
    .from(clientsTable)
    .leftJoin(campaignsTable, eq(campaignsTable.clientId, clientsTable.id))
    .leftJoin(transactionsTable, and(
      eq(transactionsTable.campaignId, campaignsTable.id),
      whereClause,
    ))
    .groupBy(clientsTable.id, clientsTable.name, clientsTable.buyingHouse)
    .orderBy(sql`sum(${transactionsTable.profit}) desc nulls last`);

  res.json(GetAnalyticsByClientResponse.parse(rows.map(r => {
    const revenue = parseFloat(r.revenue ?? "0");
    const profit = parseFloat(r.profit ?? "0");
    const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;
    return {
      clientId: r.clientId,
      clientName: r.clientName,
      buyingHouse: r.buyingHouse,
      revenue,
      cost: parseFloat(r.cost ?? "0"),
      profit,
      marginPct,
      transactionCount: r.transactionCount ?? 0,
    };
  })));
});

router.get("/analytics/by-platform", async (req, res): Promise<void> => {
  const qp = GetAnalyticsByPlatformQueryParams.safeParse(req.query);
  if (!qp.success) {
    res.status(400).json({ error: qp.error.message });
    return;
  }

  const conditions = buildDateConditions(qp.data.dateFrom, qp.data.dateTo);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      platformId: platformsTable.id,
      platformName: platformsTable.name,
      currency: platformsTable.currency,
      revenue: sql<string>`coalesce(sum(${transactionsTable.spend}), 0)`,
      cost: sql<string>`coalesce(sum(${transactionsTable.cost}), 0)`,
      profit: sql<string>`coalesce(sum(${transactionsTable.profit}), 0)`,
      transactionCount: sql<number>`count(${transactionsTable.id})::int`,
    })
    .from(platformsTable)
    .leftJoin(campaignsTable, eq(campaignsTable.platformId, platformsTable.id))
    .leftJoin(transactionsTable, and(
      eq(transactionsTable.campaignId, campaignsTable.id),
      whereClause,
    ))
    .groupBy(platformsTable.id, platformsTable.name, platformsTable.currency)
    .orderBy(sql`sum(${transactionsTable.profit}) desc nulls last`);

  res.json(GetAnalyticsByPlatformResponse.parse(rows.map(r => {
    const revenue = parseFloat(r.revenue ?? "0");
    const profit = parseFloat(r.profit ?? "0");
    const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;
    return {
      platformId: r.platformId,
      platformName: r.platformName,
      currency: r.currency,
      revenue,
      cost: parseFloat(r.cost ?? "0"),
      profit,
      marginPct,
      transactionCount: r.transactionCount ?? 0,
    };
  })));
});

router.get("/analytics/alerts", async (req, res): Promise<void> => {
  // Find campaigns with recent negative profit or low margin
  const rows = await db
    .select({
      campaignId: campaignsTable.id,
      campaignName: campaignsTable.name,
      clientName: clientsTable.name,
      platformName: platformsTable.name,
      totalSpend: sql<string>`coalesce(sum(${transactionsTable.spend}), 0)`,
      totalProfit: sql<string>`coalesce(sum(${transactionsTable.profit}), 0)`,
    })
    .from(campaignsTable)
    .leftJoin(clientsTable, eq(clientsTable.id, campaignsTable.clientId))
    .leftJoin(platformsTable, eq(platformsTable.id, campaignsTable.platformId))
    .leftJoin(transactionsTable, eq(transactionsTable.campaignId, campaignsTable.id))
    .groupBy(campaignsTable.id, campaignsTable.name, clientsTable.name, platformsTable.name)
    .having(sql`count(${transactionsTable.id}) > 0`);

  const alerts: Array<{
    id: string;
    type: "negative_profit" | "low_margin";
    severity: "warning" | "critical";
    message: string;
    campaignId: number;
    campaignName: string;
    clientName: string | null;
    platformName: string | null;
    value: number | null;
  }> = [];

  for (const row of rows) {
    const spend = parseFloat(row.totalSpend ?? "0");
    const profit = parseFloat(row.totalProfit ?? "0");
    const margin = spend > 0 ? (profit / spend) * 100 : 0;

    if (profit < 0) {
      alerts.push({
        id: `neg-${row.campaignId}`,
        type: "negative_profit",
        severity: "critical",
        message: `Campaign "${row.campaignName}" has negative profit of $${Math.abs(profit).toFixed(2)}`,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        clientName: row.clientName ?? null,
        platformName: row.platformName ?? null,
        value: profit,
      });
    } else if (margin < 10) {
      alerts.push({
        id: `low-${row.campaignId}`,
        type: "low_margin",
        severity: "warning",
        message: `Campaign "${row.campaignName}" has low margin of ${margin.toFixed(1)}%`,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        clientName: row.clientName ?? null,
        platformName: row.platformName ?? null,
        value: margin,
      });
    }
  }

  res.json(GetAlertsResponse.parse(alerts));
});

export default router;
