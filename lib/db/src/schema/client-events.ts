import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { costModelsTable } from "./cost-models";

export const clientEventsTable = pgTable("client_events", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  costModelId: integer("cost_model_id").references(() => costModelsTable.id, { onDelete: "set null" }),
  billableRate: numeric("billable_rate", { precision: 12, scale: 4 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ClientEvent = typeof clientEventsTable.$inferSelect;
