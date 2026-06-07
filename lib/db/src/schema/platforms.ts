import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";

export const platformsTable = pgTable("platforms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // contact
  address: text("address"),
  pocName: text("poc_name"),
  pocNumber: text("poc_number"),
  pocEmail: text("poc_email"),
  companyEmail: text("company_email"),
  companyNumber: text("company_number"),
  // banking
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  bankAddress: text("bank_address"),
  swiftCode: text("swift_code"),
  iban: text("iban"),
  // legal / tax
  salesTaxNumber: text("sales_tax_number"),
  ntnNumber: text("ntn_number"),
  paymentTerms: text("payment_terms"),
  bulkDiscountPct: numeric("bulk_discount_pct", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Platform = typeof platformsTable.$inferSelect;
