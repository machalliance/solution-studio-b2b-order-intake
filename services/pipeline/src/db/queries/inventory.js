/**
 * @file inventory.js
 * @description Database queries for the inventory table.
 *              Implements availability checking against the MACH ODM Inventory entity.
 *
 * MACH ODM Inventory entity fields used:
 *   sku_id, description, available_qty, backorderable, backorder_eta, active
 * @module db/queries/inventory
 */
import pool         from '../pool.js';
import { config }   from '../../config.js';

/**
 * Load the full active inventory catalogue for AI SKU resolution.
 * Only active SKUs are returned - inactive items are not matchable targets.
 * @returns {Promise<Object[]>} all active inventory rows (MACH ODM Inventory entity shape)
 */
export async function getInventoryCatalogue() {
  const { rows } = await pool.query('SELECT * FROM inventory WHERE active = TRUE');
  return rows;
}

/**
 * Fetch a single inventory item by its internal sku_id.
 * Used for the exact-match step in SKU resolution (checks both active and inactive).
 * @param {string} skuId - MACH ODM Inventory.sku_id
 * @returns {Promise<Object|null>} inventory row, or null if not found
 */
export async function getInventoryItem(skuId) {
  const { rows } = await pool.query(
    'SELECT * FROM inventory WHERE sku_id = $1', [skuId]
  );
  return rows[0] || null;
}

/**
 * Check whether the requested quantity can be fulfilled, applying MACH ODM Inventory rules.
 *
 * Availability logic:
 *   - inactive SKU -> outcome: 'inactive', pass: false
 *   - available_qty >= requested -> outcome: 'in_stock', pass: true
 *   - backorderable + BACKORDER_AUTO_SUBMIT=true -> outcome: 'backorder_auto', pass: true
 *   - backorderable + BACKORDER_AUTO_SUBMIT=false -> outcome: 'backorder_review', pass: false
 *   - not enough stock, not backorderable -> outcome: 'out_of_stock', pass: false
 *
 * BACKORDER_AUTO_SUBMIT (default: true) controls whether backorderable shortfalls
 * are auto-submitted to ERP or routed to human review.
 *
 * @param {string} skuId              - MACH ODM Inventory.sku_id
 * @param {number} quantityRequested  - quantity from the order line item
 * @returns {Promise<{
 *   pass: boolean,           - true if the line can proceed to ERP (in stock or backorder-auto)
 *   backorder: boolean,      - true if the line will be on backorder
 *   backorderEta: Date|null, - expected availability date from Inventory.backorder_eta
 *   outcome: string          - 'in_stock'|'backorder_auto'|'backorder_review'|'out_of_stock'|'inactive'|'not_found'
 * }>}
 */
export async function checkAvailability(skuId, quantityRequested) {
  const item = await getInventoryItem(skuId);
  if (!item) return { pass: false, backorder: false, backorderEta: null, outcome: 'not_found' };
  if (!item.active) return { pass: false, backorder: false, backorderEta: null, outcome: 'inactive' };

  if (item.available_qty >= quantityRequested) {
    return { pass: true, backorder: false, backorderEta: null, outcome: 'in_stock' };
  }

  if (item.backorderable) {
    const autoSubmit = config.BACKORDER_AUTO_SUBMIT;
    return {
      pass:         autoSubmit,
      backorder:    true,
      backorderEta: item.backorder_eta,
      outcome:      autoSubmit ? 'backorder_auto' : 'backorder_review',
    };
  }

  return { pass: false, backorder: false, backorderEta: null, outcome: 'out_of_stock' };
}
