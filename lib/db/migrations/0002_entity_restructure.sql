-- lib/db/migrations/0002_entity_restructure.sql
-- Entity restructure: buying_houses becomes first-class entity.
-- billing_records.client_id → buying_house_id.
-- clients.buying_house text removed; clients.buying_house_id FK added.

-- 1. Create buying_houses table
CREATE TABLE IF NOT EXISTS buying_houses (
  id serial PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Populate buying_houses from distinct clients currently referenced in billing_records
INSERT INTO buying_houses (name)
SELECT DISTINCT c.name
FROM clients c
INNER JOIN billing_records br ON br.client_id = c.id;

-- 3. Add buying_house_id to billing_records (nullable for now)
ALTER TABLE billing_records ADD COLUMN buying_house_id integer;

-- 4. Populate billing_records.buying_house_id from the new buying_houses by name match
UPDATE billing_records br
SET buying_house_id = bh.id
FROM clients c
INNER JOIN buying_houses bh ON bh.name = c.name
WHERE br.client_id = c.id;

-- 5. Make buying_house_id NOT NULL and add FK
ALTER TABLE billing_records
  ALTER COLUMN buying_house_id SET NOT NULL,
  ADD CONSTRAINT billing_records_buying_house_id_fkey
    FOREIGN KEY (buying_house_id) REFERENCES buying_houses(id);

-- 6. Drop old client_id column from billing_records
ALTER TABLE billing_records DROP COLUMN client_id;

-- 7. Add buying_house_id (nullable FK) to clients
ALTER TABLE clients
  ADD COLUMN buying_house_id integer
  REFERENCES buying_houses(id) ON DELETE SET NULL;

-- 8. Drop old buying_house text column from clients
ALTER TABLE clients DROP COLUMN buying_house;
