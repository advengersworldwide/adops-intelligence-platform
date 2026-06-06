import { pgTable, text, serial, timestamp, numeric, pgEnum, integer } from "drizzle-orm/pg-core";
import { buyingHousesTable } from "./buying-houses";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pricingModelEnum = pgEnum("pricing_model", ["fixed", "percentage"]);

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  buyingHouseId: integer("buying_house_id")
    .references(() => buyingHousesTable.id, { onDelete: "set null" }),
  pricingModel: pricingModelEnum("pricing_model").notNull().default("fixed"),
  marginValue: numeric("margin_value", { precision: 12, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
