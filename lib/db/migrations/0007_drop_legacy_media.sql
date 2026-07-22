-- Retire the legacy "media" model. Dashboard/analytics were re-pointed to billing_records.
-- Applied directly (not via drizzle-kit push) to avoid the interactive drop prompt.
DROP TABLE IF EXISTS "bill_transactions";
DROP TABLE IF EXISTS "payment_bills";
DROP TABLE IF EXISTS "bills";
DROP TABLE IF EXISTS "transactions";
DROP TABLE IF EXISTS "campaigns";
