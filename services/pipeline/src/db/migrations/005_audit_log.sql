CREATE TABLE IF NOT EXISTS audit_log (
  event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID REFERENCES orders(order_id) ON DELETE SET NULL,
  event_type      VARCHAR(30) NOT NULL CHECK (event_type IN (
                    'intake','extraction','sku_resolution','customer_lookup',
                    'validation','routing','erp_submission','clarify_sent','error')),
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel         VARCHAR(20),
  outcome         VARCHAR(20),
  confidence_score INTEGER,
  ai_reasoning    TEXT        NOT NULL DEFAULT '',
  candidates      JSONB       NOT NULL DEFAULT '[]',
  metadata        JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_order_id   ON audit_log(order_id);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp  ON audit_log(timestamp DESC);
