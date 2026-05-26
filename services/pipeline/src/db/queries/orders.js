/**
 * @file orders.js
 * @description Database queries for the orders table.
 *              The orders table is the central record for every document received
 *              by the pipeline, from initial intake through to final outcome.
 * @module db/queries/orders
 */
import pool         from '../pool.js';
import { config }   from '../../config.js';

/**
 * Insert a new order row at intake (status = 'received').
 * @param {Object} order
 * @param {string} order.channel          - 'email' | 'edi'
 * @param {string} order.contentType      - 'plain_text'|'pdf'|'csv'|'xlsx'|'x12_850'
 * @param {string|null} order.rawContent  - initial channel body (overwritten after parsing)
 * @param {Object|null} order.channelMetadata - envelope data stored as JSONB
 * @param {string|null} order.senderEmail
 * @param {string|null} order.poNumber    - null at intake; set after extraction
 * @returns {Promise<Object>} created orders row (all columns)
 */
export async function createOrder(order) {
  const { rows } = await pool.query(
    `INSERT INTO orders (order_id, channel, content_type, raw_content, channel_metadata,
      sender_email, po_number, status)
     VALUES (COALESCE($1, gen_random_uuid()),$2,$3,$4,$5,$6,$7,'received')
     RETURNING *`,
    [order.orderId || null, order.channel, order.contentType, order.rawContent,
     order.channelMetadata, order.senderEmail, order.poNumber]
  );
  return rows[0];
}

/**
 * Update arbitrary columns on an order row.
 * Accepts camelCase keys and converts them to snake_case automatically.
 * All calls set updated_at = NOW() so the UI always shows the latest change time.
 *
 * @param {string} orderId - UUID
 * @param {Object} updates - camelCase column names -> values
 * @returns {Promise<Object>} updated orders row
 */
export async function updateOrder(orderId, updates) {
  const fields = Object.keys(updates)
    .map((k, i) => `${toSnake(k)} = $${i + 2}`)
    .join(', ');
  const values = Object.values(updates);
  const { rows } = await pool.query(
    `UPDATE orders SET ${fields}, updated_at = NOW()
     WHERE order_id = $1 RETURNING *`,
    [orderId, ...values]
  );
  return rows[0];
}

/**
 * List orders most-recent first, for the Agent Control Interface order feed.
 * @param {number} [limit=50]   - max rows to return (UI default: 50)
 * @param {number} [offset=0]   - pagination offset
 * @returns {Promise<Object[]>}
 */
export async function listOrders(limit = 50, offset = 0) {
  const { rows } = await pool.query(
    `SELECT * FROM orders ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

/**
 * Fetch a single order by ID.
 * @param {string} orderId
 * @returns {Promise<Object|null>} orders row, or null if not found
 */
export async function getOrder(orderId) {
  const { rows } = await pool.query(
    'SELECT * FROM orders WHERE order_id = $1', [orderId]
  );
  return rows[0] || null;
}

/**
 * Check whether a PO number from a given buyer has already been received within
 * the configured duplicate detection window.
 *
 * Rejected orders are excluded so a legitimately resent PO after an initial
 * processing failure is not incorrectly flagged as a duplicate.
 *
 * Window is configurable via DUPLICATE_PO_WINDOW_DAYS (default 30).
 *
 * @param {string} poNumber      - MACH ODM Order.poNumber
 * @param {string} buyerAccountId - MACH ODM Order.buyer.accountId
 * @returns {Promise<boolean>} true if a matching non-rejected order exists in the window
 */
export async function isDuplicatePO(poNumber, buyerAccountId) {
  const windowDays = config.DUPLICATE_PO_WINDOW_DAYS;
  const { rows } = await pool.query(
    `SELECT 1 FROM orders
     WHERE po_number = $1
       AND buyer_account_id = $2
       AND created_at > NOW() - ($3 || ' days')::interval
       AND routing_outcome != 'reject'
     LIMIT 1`,
    [poNumber, buyerAccountId, windowDays]
  );
  return rows.length > 0;
}

/**
 * Fetch orders pending human review, oldest-first (longest-waiting at top of queue).
 * Only returns orders in routing_outcome='review' AND status='review' - orders that
 * have already been actioned (review_approve, review_reject, etc.) are excluded.
 *
 * @returns {Promise<Object[]>}
 */
export async function getReviewQueue() {
  const { rows } = await pool.query(
    `SELECT * FROM orders
     WHERE routing_outcome = 'review' AND status = 'review'
     ORDER BY created_at ASC`
  );
  return rows;
}

/**
 * Convert a camelCase JavaScript key to snake_case for PostgreSQL column names.
 * e.g. 'routingOutcome' -> 'routing_outcome', 'aiReasoning' -> 'ai_reasoning'
 * @param {string} str
 * @returns {string}
 */
function toSnake(str) {
  return str.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}
