/**
 * @file line_items.js
 * @description Database queries for the line_items table.
 *              All SQL for order line items lives here - graph nodes and API routes
 *              import named functions, never pool directly.
 * @module db/queries/line_items
 */
import pool from '../pool.js';

/**
 * Insert line item rows for an order after SKU resolution.
 * Called by the validation node once SKU resolution is complete.
 * Uses ON CONFLICT DO NOTHING so re-runs on the same order are safe.
 *
 * @param {string}   orderId       - UUID of the parent order
 * @param {import('../../graph/state.js').SkuResolution[]} skuResolutions
 * @param {Object[]} lineItems     - raw MACH ODM lineItems[] from extractedOrder
 * @returns {Promise<void>}
 */
export async function createLineItems(orderId, skuResolutions, lineItems) {
  for (const res of skuResolutions) {
    const src = (lineItems || []).find(l => l.lineNumber === res.lineNumber) || {};
    await pool.query(
      `INSERT INTO line_items
         (order_id, line_number, buyer_sku, resolved_sku_id, product_description,
          quantity, unit_of_measure, unit_price, line_total,
          sku_resolution_status, sku_candidates, sku_ai_reasoning)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT DO NOTHING`,
      [
        orderId,
        res.lineNumber,
        res.buyerSku,
        res.resolvedSkuId || null,
        src.productDescription || null,
        src.quantity || res.quantity || null,
        src.unitOfMeasure || null,
        src.unitPrice || null,
        src.quantity && src.unitPrice ? src.quantity * src.unitPrice : null,
        res.status,
        JSON.stringify(res.candidates || []),
        res.aiReasoning || null,
      ]
    );
  }
}

/**
 * Update backorder flags on line_items after ERP submission.
 * The ERP may amend backorder status on acceptance, so this runs post-submit.
 *
 * @param {string} orderId
 * @param {Array<{ lineNumber: number, backorder: boolean, backorderEta: Date|null }>} backorders
 * @returns {Promise<void>}
 */
export async function updateLineItemsBackorder(orderId, backorders) {
  for (const line of backorders) {
    await pool.query(
      `UPDATE line_items
       SET backorder_flag = $1, backorder_eta = $2
       WHERE order_id = $3 AND line_number = $4`,
      [line.backorder || false, line.backorderEta || null, orderId, line.lineNumber]
    );
  }
}

/**
 * Fetch all line items for an order, ordered by line number.
 * Used by GET /orders/:id and the human-review approve flow.
 *
 * @param {string} orderId
 * @returns {Promise<Object[]>} line_items rows
 */
export async function getOrderLineItems(orderId) {
  const { rows } = await pool.query(
    'SELECT * FROM line_items WHERE order_id = $1 ORDER BY line_number',
    [orderId]
  );
  return rows;
}
