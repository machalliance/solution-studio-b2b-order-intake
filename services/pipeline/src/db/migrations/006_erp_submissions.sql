CREATE TABLE IF NOT EXISTS erp_submissions (
  id            SERIAL PRIMARY KEY,
  erp_order_id  UUID NOT NULL,
  payload       JSONB NOT NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
