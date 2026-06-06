import { db, clientsTable, platformsTable, campaignsTable, transactionsTable } from "@workspace/db";

async function seed() {
  const logger = console;
  logger.log("Seeding database...");

  const existingClients = await db.select().from(clientsTable);
  if (existingClients.length > 0) {
    logger.log(`Already seeded (${existingClients.length} clients). Skipping.`);
    process.exit(0);
  }

  const [acme, globex, initech] = await db.insert(clientsTable).values([
    { name: "Acme Corp" },
    { name: "Globex Media" },
    { name: "Initech Group" },
  ]).returning();

  const [ttd, dv360, amazon] = await db.insert(platformsTable).values([
    { name: "The Trade Desk" },
    { name: "DV360" },
    { name: "Amazon DSP" },
  ]).returning();

  const [c1, c2, c3, c4, c5] = await db.insert(campaignsTable).values([
    { name: "Acme Q1 Brand", clientId: acme.id, platformId: ttd.id },
    { name: "Acme Retargeting", clientId: acme.id, platformId: dv360.id },
    { name: "Globex Awareness", clientId: globex.id, platformId: ttd.id },
    { name: "Globex Performance", clientId: globex.id, platformId: amazon.id },
    { name: "Initech Launch", clientId: initech.id, platformId: dv360.id },
  ]).returning();

  const months = [
    { suffix: "2026-01-15", multiplier: 1.0 },
    { suffix: "2026-02-14", multiplier: 1.1 },
    { suffix: "2026-03-15", multiplier: 1.05 },
    { suffix: "2026-04-14", multiplier: 1.15 },
    { suffix: "2026-05-15", multiplier: 1.2 },
  ];

  const baseTx = [
    { campaignId: c1.id, spend: 45000, cost: 38000 },
    { campaignId: c2.id, spend: 28000, cost: 22000 },
    { campaignId: c3.id, spend: 62000, cost: 57000 },
    { campaignId: c4.id, spend: 35000, cost: 29000 },
    { campaignId: c5.id, spend: 18000, cost: 19500 }, // negative margin
  ];

  let count = 0;
  for (const month of months) {
    for (const base of baseTx) {
      const spend = Math.round(base.spend * month.multiplier);
      const cost = Math.round(base.cost * month.multiplier);
      const profit = spend - cost;
      await db.insert(transactionsTable).values({
        campaignId: base.campaignId,
        date: month.suffix,
        spend: String(spend),
        cost: String(cost),
        profit: String(profit),
      });
      count++;
    }
  }

  logger.log(`Seeded: 3 clients, 3 platforms, 5 campaigns, ${count} transactions`);
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
