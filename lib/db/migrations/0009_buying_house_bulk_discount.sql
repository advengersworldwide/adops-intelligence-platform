-- lib/db/migrations/0009_buying_house_bulk_discount.sql
-- Add bulk_discount_pct column to buying_houses table

ALTER TABLE buying_houses
  ADD COLUMN IF NOT EXISTS bulk_discount_pct numeric(6, 2);
