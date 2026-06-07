import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";

export const costResourcesTable = pgTable("cost_resources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  period: text("period").notNull(),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CostResource = typeof costResourcesTable.$inferSelect;
