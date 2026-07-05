import { pgTable, serial, integer, text, numeric } from "drizzle-orm/pg-core";
import { billingLinesTable } from "./billing-lines";
import { clientEventsTable } from "./client-events";

export const billingEventItemsTable = pgTable("billing_event_items", {
  id: serial("id").primaryKey(),
  billingLineId: integer("billing_line_id").notNull().references(() => billingLinesTable.id, { onDelete: "cascade" }),
  clientEventId: integer("client_event_id").notNull().references(() => clientEventsTable.id, { onDelete: "restrict" }),
  eventName: text("event_name").notNull(),                              // snapshot
  billableRate: numeric("billable_rate", { precision: 12, scale: 4 }).notNull(), // snapshot (client)
  payoutRate: numeric("payout_rate", { precision: 12, scale: 4 }).notNull(),     // snapshot (partner)
  eventCount: integer("event_count").notNull(),
});

export type BillingEventItem = typeof billingEventItemsTable.$inferSelect;