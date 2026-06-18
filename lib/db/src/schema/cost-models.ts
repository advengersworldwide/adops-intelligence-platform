import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const costModelsTable = pgTable("cost_models", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CostModel = typeof costModelsTable.$inferSelect;
