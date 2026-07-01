import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";
import { clientPurchaseOrdersTable } from "./client-purchase-orders";
import { usersTable } from "./auth";

export const partnerPurchaseOrdersTable = pgTable("partner_purchase_orders", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "restrict" }),
  clientPurchaseOrderId: integer("client_purchase_order_id").notNull()
    .references(() => clientPurchaseOrdersTable.id, { onDelete: "restrict" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  totalBudget: numeric("total_budget", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PartnerPurchaseOrder = typeof partnerPurchaseOrdersTable.$inferSelect;
