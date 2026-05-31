import { eq, gte, sum } from "drizzle-orm";
import {
  db,
  clientsTable,
  platformsTable,
  campaignsTable,
  transactionsTable,
} from "@workspace/db";

export async function buildContext(): Promise<string> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

  const [clients, platforms, campaigns, txAgg, campaignPerf] = await Promise.all([
    db.select({ name: clientsTable.name, pricingModel: clientsTable.pricingModel })
      .from(clientsTable),

    db.select({ name: platformsTable.name })
      .from(platformsTable),

    db.select({
      id: campaignsTable.id,
      name: campaignsTable.name,
      clientName: clientsTable.name,
      platformName: platformsTable.name,
    })
      .from(campaignsTable)
      .leftJoin(clientsTable, eq(campaignsTable.clientId, clientsTable.id))
      .leftJoin(platformsTable, eq(campaignsTable.platformId, platformsTable.id))
      .limit(50),

    db.select({
      totalSpend: sum(transactionsTable.spend),
      totalCost: sum(transactionsTable.cost),
      totalProfit: sum(transactionsTable.profit),
    })
      .from(transactionsTable)
      .where(gte(transactionsTable.date, dateStr)),

    db.select({
      campaignId: transactionsTable.campaignId,
      totalSpend: sum(transactionsTable.spend),
      totalProfit: sum(transactionsTable.profit),
    })
      .from(transactionsTable)
      .where(gte(transactionsTable.date, dateStr))
      .groupBy(transactionsTable.campaignId),
  ]);

  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const pct = (n: number) => `${n.toFixed(1)}%`;

  const totalSpend = parseFloat(txAgg[0]?.totalSpend ?? "0");
  const totalCost = parseFloat(txAgg[0]?.totalCost ?? "0");
  const totalProfit = parseFloat(txAgg[0]?.totalProfit ?? "0");
  const overallMargin = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0;

  const campaignNameMap = new Map(campaigns.map(c => [c.id, c.name]));

  const perfWithMargin = campaignPerf.map(c => {
    const spend = parseFloat(c.totalSpend ?? "0");
    const profit = parseFloat(c.totalProfit ?? "0");
    const margin = spend > 0 ? (profit / spend) * 100 : 0;
    return { name: campaignNameMap.get(c.campaignId) ?? `Campaign ${c.campaignId}`, profit, margin };
  });

  const top5 = [...perfWithMargin].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const bottom5 = [...perfWithMargin].sort((a, b) => a.margin - b.margin).slice(0, 5);
  const alerts = perfWithMargin.filter(c => c.profit < 0 || c.margin < 10);

  const clientList = clients.length
    ? clients.map(c => `${c.name} (${c.pricingModel})`).join(", ")
    : "None";
  const platformList = platforms.length
    ? platforms.map(p => p.name).join(", ")
    : "None";
  const campaignList = campaigns.length
    ? campaigns.map(c => `${c.name} [${c.clientName ?? "?"}/${c.platformName ?? "?"}]`).join(", ") +
      (campaigns.length === 50 ? " (showing first 50)" : "")
    : "None";
  const top5List = top5.length
    ? top5.map(c => `${c.name}: ${fmt(c.profit)}`).join(", ")
    : "No transaction data";
  const bottom5List = bottom5.length
    ? bottom5.map(c => `${c.name}: ${pct(c.margin)}`).join(", ")
    : "No transaction data";
  const alertList = alerts.length
    ? alerts.map(c => `${c.name} (profit: ${fmt(c.profit)}, margin: ${pct(c.margin)})`).join("; ")
    : "None";

  return `You are an AI assistant for AdOps Intelligence (Advengers Worldwide).
You have access to real-time advertising operations data. Today: ${new Date().toISOString().split("T")[0]}.

CLIENTS (${clients.length}): ${clientList}
PLATFORMS (${platforms.length}): ${platformList}
CAMPAIGNS (${campaigns.length} total): ${campaignList}
LAST 30 DAYS:
  Spend: ${fmt(totalSpend)} | Cost: ${fmt(totalCost)} | Profit: ${fmt(totalProfit)} | Margin: ${pct(overallMargin)}
TOP 5 CAMPAIGNS BY PROFIT: ${top5List}
BOTTOM 5 CAMPAIGNS BY MARGIN: ${bottom5List}
ACTIVE ALERTS: ${alertList}

Answer questions about this data concisely and accurately.
Only discuss topics relevant to advertising operations and this data.
Write in plain professional prose. Do not use markdown formatting, bullet symbols,
asterisks, pound signs, or emojis. Keep responses short and to the point — 2 to 4
sentences maximum unless a longer answer is clearly required. Never pad responses.`;
}
