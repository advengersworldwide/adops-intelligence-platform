import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const paymentTermsTable = pgTable("payment_terms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaymentTerm = typeof paymentTermsTable.$inferSelect;
