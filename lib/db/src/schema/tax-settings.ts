import { pgTable, serial, numeric, timestamp } from "drizzle-orm/pg-core";

// Global tax configuration. The app maintains exactly one row (id = 1).
export const taxSettingsTable = pgTable("tax_settings", {
  id: serial("id").primaryKey(),
  remittanceTaxPct: numeric("remittance_tax_pct", { precision: 6, scale: 2 }).notNull(),
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }).notNull(),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type TaxSettings = typeof taxSettingsTable.$inferSelect;
