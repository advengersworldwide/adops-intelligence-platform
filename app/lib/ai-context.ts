import { db, clientsTable, partnersTable, billingRecordsTable } from "@workspace/db";
import { aggregateTotals, aggregateBy, type AggRecord } from "@/lib/analytics/billing-records-agg";

export async function buildContext(): Promise<string> {
  const [clients, platforms, recs] = await Promise.all([
    db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable),
    db.select({ name: partnersTable.name }).from(partnersTable),
    db.select().from(billingRecordsTable),
  ]);

  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const pct = (n: number) => `${n.toFixed(1)}%`;

  const clientNameMap = new Map(clients.map(c => [c.id, c.name]));
  const totals = aggregateTotals(recs as AggRecord[]);

  const byClient = aggregateBy(recs as AggRecord[], (r) => r.clientId);
  const clientIds = [...byClient.keys()].filter((id): id is number => id != null);
  const perfWithMargin = clientIds.map((id) => {
    const t = byClient.get(id)!;
    return { name: clientNameMap.get(id) ?? `Client ${id}`, profit: t.profit, margin: t.marginPct };
  });
  const top5 = [...perfWithMargin].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const bottom5 = [...perfWithMargin].sort((a, b) => a.margin - b.margin).slice(0, 5);
  const alerts = perfWithMargin.filter(c => c.profit < 0 || c.margin < 10);

  return `You are an AI assistant for AdOps Intelligence (Advengers Worldwide).
You have access to real-time advertising operations data. Today: ${new Date().toISOString().split("T")[0]}.

CLIENTS (${clients.length}): ${clients.length ? clients.map(c => c.name).join(", ") : "None"}
PLATFORMS (${platforms.length}): ${platforms.length ? platforms.map(p => p.name).join(", ") : "None"}
BILLING RECORDS (${recs.length} total across ${clientIds.length} client${clientIds.length === 1 ? "" : "s"})
TOTALS: Revenue: ${fmt(totals.revenue)} | Cost: ${fmt(totals.cost)} | Profit: ${fmt(totals.profit)} | Margin: ${pct(totals.marginPct)}
TOP 5 CLIENTS BY PROFIT: ${top5.length ? top5.map(c => `${c.name}: ${fmt(c.profit)}`).join(", ") : "No billing data"}
BOTTOM 5 CLIENTS BY MARGIN: ${bottom5.length ? bottom5.map(c => `${c.name}: ${pct(c.margin)}`).join(", ") : "No billing data"}
ACTIVE ALERTS: ${alerts.length ? alerts.map(c => `${c.name} (profit: ${fmt(c.profit)}, margin: ${pct(c.margin)})`).join("; ") : "None"}

Answer questions about this data concisely and accurately.
Only discuss topics relevant to advertising operations and this data.
Write in plain professional prose. Do not use markdown formatting, bullet symbols,
asterisks, pound signs, or emojis. Keep responses short and to the point — 2 to 4
sentences maximum unless a longer answer is clearly required. Never pad responses.`;
}
