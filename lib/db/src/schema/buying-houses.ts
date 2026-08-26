import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";
import { kycColumns } from "./kyc-columns";

export const buyingHousesTable = pgTable("buying_houses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ...kycColumns,
  bulkDiscountPct: numeric("bulk_discount_pct", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BuyingHouse = typeof buyingHousesTable.$inferSelect;

