-- 0004_forex_remittance_cleanup.sql
-- Remove per-entity forex rate config (entered per billing record instead)
-- Move remittance_tax_pct from platforms to buying_houses

-- buying_houses: drop forex_selling_rate, add remittance_tax_pct
ALTER TABLE buying_houses
  DROP COLUMN forex_selling_rate,
  ADD COLUMN remittance_tax_pct numeric(6,2);

-- platforms: drop forex_buying_rate and remittance_tax_pct
ALTER TABLE platforms
  DROP COLUMN forex_buying_rate,
  DROP COLUMN remittance_tax_pct;
