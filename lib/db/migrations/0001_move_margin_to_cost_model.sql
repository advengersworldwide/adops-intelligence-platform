-- Move margin_pct from billing_records to platform_cost_models.
-- Cost model now owns name + payout_rate + margin_pct.
-- Billing records keep only pins; margin is read from the joined cost model.

ALTER TABLE platform_cost_models ADD COLUMN margin_pct numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE platform_cost_models ALTER COLUMN margin_pct DROP DEFAULT;
ALTER TABLE billing_records DROP COLUMN IF EXISTS margin_pct;
