-- MACH ODM: Order entity
CREATE TABLE IF NOT EXISTS orders (
  order_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         VARCHAR(20)  NOT NULL CHECK (channel IN ('email', 'edi')),
  content_type    VARCHAR(20)  NOT NULL CHECK (content_type IN ('plain_text','pdf','csv','xlsx','x12_850')),
  raw_content     TEXT,
  channel_metadata JSONB,
  sender_email    VARCHAR(255),
  po_number       VARCHAR(255),
  order_date      DATE,
  buyer_account_id VARCHAR(50),
  buyer_company   VARCHAR(255),
  buyer_email     VARCHAR(255),
  buyer_phone     VARCHAR(50),
  buyer_address   JSONB,            -- MACH ODM: Address utility
  shipping_address JSONB,           -- MACH ODM: Address utility
  requested_delivery_date DATE,
  currency        VARCHAR(10),
  extracted_order JSONB,
  confidence_score INTEGER CHECK (confidence_score BETWEEN 0 AND 100),
  ai_reasoning    TEXT,
  routing_outcome VARCHAR(20) CHECK (routing_outcome IN ('clarify','reject','review','submit')),
  routing_reason  TEXT,
  status          VARCHAR(30) NOT NULL DEFAULT 'received',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_channel    ON orders(channel);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_po_number  ON orders(po_number, buyer_account_id);
