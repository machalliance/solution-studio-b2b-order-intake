INSERT INTO inventory (sku_id, description, available_qty, stock_status, backorderable) VALUES
  ('WDGT-BLUE-L',  'Pelc Widget Blue Lg',      120, 'in_stock',    FALSE),
  ('WDGT-RED-L',   'Pelc Widget Red Lg',        0,  'backorder',   TRUE),
  ('BOLT-M8-500',  'Torchline M8 Bolt Set',    400, 'in_stock',    FALSE),
  ('GSKT-A1-STD',  'Ironfeld Gasket A1 Std',     8, 'in_stock',    FALSE),
  ('FILT-HX-220',  'Solstice Filter HX 220',     0, 'out_of_stock',FALSE),
  ('PUMP-X9-DISC', 'Solstice Pump X9',            0, 'out_of_stock',FALSE)
ON CONFLICT (sku_id) DO NOTHING;
