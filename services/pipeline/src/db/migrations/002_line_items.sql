-- MACH ODM: Order entity (line items)
CREATE TABLE IF NOT EXISTS line_items (
  line_item_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  line_number     INTEGER NOT NULL,
  buyer_sku       VARCHAR(255),
  resolved_sku_id VARCHAR(50),
  product_description TEXT,
  quantity        NUMERIC(12,4),
  unit_of_measure VARCHAR(50),
  unit_price      NUMERIC(12,4),
  line_total      NUMERIC(12,4),
  sku_resolution_status VARCHAR(20) CHECK (sku_resolution_status IN ('exact','auto','review','clarify','unresolved')),
  sku_candidates  JSONB,
  sku_ai_reasoning TEXT,
  backorder_flag  BOOLEAN DEFAULT FALSE,
  backorder_eta   DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_line_items_order_id ON line_items(order_id);
