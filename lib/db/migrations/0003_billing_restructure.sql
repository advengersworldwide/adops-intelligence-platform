-- lib/db/migrations/0003_billing_restructure.sql
-- Billing restructure:
-- - buying_houses gains salesTaxPct, withholdingTaxPct, forexSellingRate, bulkDiscountPct
-- - platforms: salesTaxPct + withholdingTaxPct removed, gains forexBuyingRate + bulkDiscountPct
-- - billing_records: forexRate split into forexSellingRate + forexBuyingRate, gains bulkDiscountPct,
--   platformBulkDiscountPct, clientId

-- 1. Add new fields to buying_houses
ALTER TABLE buying_houses
  ADD COLUMN sales_tax_pct numeric(6,2),
  ADD COLUMN withholding_tax_pct numeric(6,2),
  ADD COLUMN forex_selling_rate numeric(10,4),
  ADD COLUMN bulk_discount_pct numeric(6,2);

-- 2. Add new fields to platforms
ALTER TABLE platforms
  ADD COLUMN forex_buying_rate numeric(10,4),
  ADD COLUMN bulk_discount_pct numeric(6,2);

-- 3. Remove sales_tax_pct and withholding_tax_pct from platforms
ALTER TABLE platforms
  DROP COLUMN sales_tax_pct,
  DROP COLUMN withholding_tax_pct;

-- 4. Add new fields to billing_records (nullable first for data migration)
ALTER TABLE billing_records
  ADD COLUMN forex_selling_rate numeric(10,4),
  ADD COLUMN forex_buying_rate numeric(10,4),
  ADD COLUMN bulk_discount_pct numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN platform_bulk_discount_pct numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN client_id integer REFERENCES clients(id) ON DELETE SET NULL;

-- 5. Populate split forex rates from existing single rate
UPDATE billing_records
  SET forex_selling_rate = forex_rate, forex_buying_rate = forex_rate;

-- 6. Make forex rates NOT NULL now that data is populated
ALTER TABLE billing_records
  ALTER COLUMN forex_selling_rate SET NOT NULL,
  ALTER COLUMN forex_buying_rate SET NOT NULL;

-- 7. Drop the old single forex_rate column
ALTER TABLE billing_records DROP COLUMN forex_rate;

-- 8. Drop DEFAULT sentinel (columns stay NOT NULL)
ALTER TABLE billing_records
  ALTER COLUMN bulk_discount_pct DROP DEFAULT,
  ALTER COLUMN platform_bulk_discount_pct DROP DEFAULT;