import { pgTable, serial, integer, numeric, timestamp, unique } from "drizzle-orm/pg-core";
import { platformsTable } from "./platforms";
import { clientEventsTable } from "./client-events";

export const partnerEventPayoutsTable = pgTable("partner_event_payouts", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => platformsTable.id, { onDelete: "cascade" }),
  clientEventId: integer("client_event_id").notNull().references(() => clientEventsTable.id, { onDelete: "cascade" }),
  payoutRate: numeric("payout_rate", { precision: 12, scale: 4 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqPartnerEvent: unique().on(t.partnerId, t.clientEventId) }));

export type PartnerEventPayout = typeof partnerEventPayoutsTable.$inferSelect;
