import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";
import { clientsTable } from "./clients";

export const partnerClientsTable = pgTable("partner_clients", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqPartnerClient: unique().on(t.partnerId, t.clientId) }));

export type PartnerClient = typeof partnerClientsTable.$inferSelect;
