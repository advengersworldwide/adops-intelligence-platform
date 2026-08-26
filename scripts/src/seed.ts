import { db, clientsTable, partnersTable } from "@workspace/db";

async function seed() {
  const logger = console;
  logger.log("Seeding database...");

  const existingClients = await db.select().from(clientsTable);
  if (existingClients.length > 0) {
    logger.log(`Already seeded (${existingClients.length} clients). Skipping.`);
    process.exit(0);
  }

  const [acme, globex, initech] = await db.insert(clientsTable).values([
    { name: "Acme Corp", codePrefix: "ACM" },
    { name: "Globex Media", codePrefix: "GBX" },
    { name: "Initech Group", codePrefix: "INI" },
  ]).returning();

  const [ttd, dv360, amazon] = await db.insert(partnersTable).values([
    { name: "The Trade Desk", codePrefix: "TTD" },
    { name: "DV360", codePrefix: "DV3" },
    { name: "Amazon DSP", codePrefix: "AMZ" },
  ]).returning();

  logger.log(`Seeded: ${[acme, globex, initech].length} clients, ${[ttd, dv360, amazon].length} partners`);
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});

