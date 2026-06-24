import { pgTable, serial, integer, text, numeric } from "drizzle-orm/pg-core";
import { partnerPurchaseOrdersTable } from "./partner-purchase-orders";
import { clientEventsTable } from "./client-events";

export const partnerPurchaseOrderItemsTable = pgTable("partner_purchase_order_items", {
  id: serial("id").primaryKey(),
  partnerPurchaseOrderId: integer("partner_purchase_order_id").notNull()
    .references(() => partnerPurchaseOrdersTable.id, { onDelete: "cascade" }),
  clientEventId: integer("client_event_id").notNull()
    .references(() => clientEventsTable.id, { onDelete: "restrict" }),
  eventName: text("event_name").notNull(),
  cacRate: numeric("cac_rate", { precision: 12, scale: 4 }).notNull(),
  eventCount: integer("event_count").notNull(),
  lineBudget: numeric("line_budget", { precision: 14, scale: 2 }).notNull(),
});

export type PartnerPurchaseOrderItem = typeof partnerPurchaseOrderItemsTable.$inferSelect;
