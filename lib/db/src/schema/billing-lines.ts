import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { billingsTable } from "./billings";
import { partnersTable } from "./partners";
import { partnerPurchaseOrdersTable } from "./partner-purchase-orders";

export const billingLinesTable = pgTable("billing_lines", {
  id: serial("id").primaryKey(),
  billingId: integer("billing_id").notNull().references(() => billingsTable.id, { onDelete: "cascade" }),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "restrict" }),
  partnerPurchaseOrderId: integer("partner_purchase_order_id")
    .references(() => partnerPurchaseOrdersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillingLine = typeof billingLinesTable.$inferSelect;