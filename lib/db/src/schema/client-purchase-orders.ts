import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { usersTable } from "./auth";

export const clientPurchaseOrdersTable = pgTable("client_purchase_orders", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "restrict" }),
  attachmentUrl: text("attachment_url").notNull(),
  attachmentName: text("attachment_name"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ClientPurchaseOrder = typeof clientPurchaseOrdersTable.$inferSelect;
