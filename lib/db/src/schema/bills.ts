import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { buyingHousesTable } from "./buying-houses";

export const billsTable = pgTable("bills", {
  id: serial("id").primaryKey(),
  billNumber: text("bill_number").notNull().unique(),
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  buyingHouseId: integer("buying_house_id").references(() => buyingHousesTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("outstanding"),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Bill = typeof billsTable.$inferSelect;
