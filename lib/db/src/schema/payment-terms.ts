import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const paymentTermsTable = pgTable("payment_terms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  days: integer("days"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaymentTerm = typeof paymentTermsTable.$inferSelect;
