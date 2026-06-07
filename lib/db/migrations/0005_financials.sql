-- 0005_financials.sql
-- Adds bills, bill_transactions, payments, payment_bills, cost_resources

CREATE TABLE bills (
  id         serial PRIMARY KEY,
  bill_number text NOT NULL UNIQUE,
  client_id  integer REFERENCES clients(id) ON DELETE SET NULL,
  buying_house_id integer REFERENCES buying_houses(id) ON DELETE SET NULL,
  status     text NOT NULL DEFAULT 'outstanding',
  notes      text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bill_transactions (
  id                 serial PRIMARY KEY,
  bill_id            integer NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  billing_record_id  integer NOT NULL REFERENCES billing_records(id) ON DELETE CASCADE,
  UNIQUE(bill_id, billing_record_id)
);

CREATE TABLE payments (
  id               serial PRIMARY KEY,
  mode             text NOT NULL,
  total_amount     numeric(14,2) NOT NULL,
  notes            text,
  cheque_image_url text,
  receipt_url      text,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_bills (
  id             serial PRIMARY KEY,
  payment_id     integer NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  bill_id        integer NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amount_applied numeric(14,2) NOT NULL,
  UNIQUE(payment_id, bill_id)
);

CREATE TABLE cost_resources (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  amount     numeric(14,2) NOT NULL,
  period     text NOT NULL,
  notes      text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
