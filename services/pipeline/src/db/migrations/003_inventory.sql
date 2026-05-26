-- MACH ODM: Inventory entity
CREATE TABLE IF NOT EXISTS inventory (
  sku_id          VARCHAR(50)  PRIMARY KEY,
  description     VARCHAR(255) NOT NULL,
  available_qty   INTEGER      NOT NULL DEFAULT 0,
  stock_status    VARCHAR(20)  NOT NULL CHECK (stock_status IN ('in_stock','backorder','out_of_stock')),
  backorderable   BOOLEAN      NOT NULL DEFAULT FALSE,
  backorder_eta   DATE,
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
