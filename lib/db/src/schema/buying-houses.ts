import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";

export const buyingHousesTable = pgTable("buying_houses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }),
  remittanceTaxPct: numeric("remittance_tax_pct", { precision: 6, scale: 2 }),
  bulkDiscountPct: numeric("bulk_discount_pct", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BuyingHouse = typeof buyingHousesTable.$inferSelect;
