/**
 * @file audit.js
 * @description Database queries for the audit_log table.
 *              Every significant pipeline event (intake, extraction, routing, outcomes,
 *              errors) is written here, giving operators a complete per-order trace.
 * @module db/queries/audit
 */
import pool from '../pool.js';

/**
 * Append a single event to the audit log. Called by every graph node and most API
 * handlers. Multiple events per order are expected and normal.
 *
 * @param {Object} event
 * @param {string}  event.eventType       - e.g. 'intake'|'extraction'|'validation'|'routing'|
 *                                          'customer_lookup'|'sku_resolution'|'clarify_sent'|
 *                                          'erp_submission'|'error'
 * @param {string|null} [event.orderId]   - UUID of the order (null only during pre-intake errors)
 * @param {string}  [event.channel]       - 'email' | 'edi'
 * @param {string}  [event.outcome]       - 'clarify'|'reject'|'review'|'submit'
 * @param {number}  [event.confidenceScore] - 0-100 (extraction AI confidence)
 * @param {string}  [event.aiReasoning]   - structured reasoning from the AI
 * @param {Array}   [event.candidates]    - customer or SKU candidates (stored as JSONB)
 * @param {Object}  [event.metadata]      - free-form extra data for debugging (stored as JSONB)
 * @returns {Promise<Object>} created audit_log row
 */
export async function writeAuditEvent(event) {
  const { rows } = await pool.query(
    `INSERT INTO audit_log
       (order_id, event_type, channel, outcome, confidence_score,
        ai_reasoning, candidates, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      event.orderId || null,
      event.eventType,
      event.channel || null,
      event.outcome || null,
      event.confidenceScore ?? null,
      event.aiReasoning || '',
      JSON.stringify(event.candidates || []),
      JSON.stringify(event.metadata || {}),
    ]
  );
  return rows[0];
}

/**
 * Fetch all orders with their audit events nested as a JSON array.
 * Used by GET /api/audit/grouped for the per-order event timeline in the Audit Log view.
 *
 * @param {number} [limit=100] - max orders to return (capped at 500 by the route handler)
 * @returns {Promise<Object[]>} orders rows, each with an `events` JSON array
 */
export async function getAuditGrouped(limit = 100) {
  const { rows } = await pool.query(`
    SELECT
      o.*,
      COALESCE(
        json_agg(
          json_build_object(
            'event_id',         a.event_id,
            'event_type',       a.event_type,
            'timestamp',        a.timestamp,
            'outcome',          a.outcome,
            'confidence_score', a.confidence_score,
            'ai_reasoning',     a.ai_reasoning,
            'metadata',         a.metadata
          )
          ORDER BY a.timestamp ASC
        ) FILTER (WHERE a.event_id IS NOT NULL),
        '[]'::json
      ) AS events
    FROM orders o
    LEFT JOIN audit_log a ON a.order_id = o.order_id
    GROUP BY o.order_id
    ORDER BY o.created_at DESC
    LIMIT $1
  `, [limit]);
  return rows;
}

/**
 * Fetch the validation error codes recorded for an order.
 * Reads from the first 'validation' event's metadata.businessRuleErrors field.
 * Used by the review endpoint when building clarification messages.
 *
 * @param {string} orderId
 * @returns {Promise<string[]>} array of error code strings, or [] if none recorded
 */
export async function getValidationErrors(orderId) {
  const { rows } = await pool.query(
    `SELECT metadata FROM audit_log
     WHERE order_id = $1 AND event_type = 'validation'
     LIMIT 1`,
    [orderId]
  );
  return rows[0]?.metadata?.businessRuleErrors || [];
}

/**
 * List audit events with optional filtering. Used by GET /api/audit.
 * @param {Object} [filters]
 * @param {string} [filters.orderId]    - filter to a single order
 * @param {string} [filters.eventType]  - filter to a specific event type
 * @param {string} [filters.dateFrom]   - ISO timestamp lower bound (inclusive)
 * @param {string} [filters.dateTo]     - ISO timestamp upper bound (inclusive)
 * @param {number} [limit=100]          - max events to return
 * @param {number} [offset=0]           - pagination offset
 * @returns {Promise<Object[]>} audit_log rows ordered newest first
 */
export async function listAuditEvents(filters = {}, limit = 100, offset = 0) {
  const conditions = ['1=1'];
  const values = [];
  let i = 1;
  if (filters.orderId)   { conditions.push(`order_id = $${i++}`);    values.push(filters.orderId); }
  if (filters.eventType) { conditions.push(`event_type = $${i++}`);  values.push(filters.eventType); }
  if (filters.dateFrom)  { conditions.push(`timestamp >= $${i++}`);  values.push(filters.dateFrom); }
  if (filters.dateTo)    { conditions.push(`timestamp <= $${i++}`);  values.push(filters.dateTo); }
  values.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT * FROM audit_log WHERE ${conditions.join(' AND ')}
     ORDER BY timestamp DESC LIMIT $${i} OFFSET $${i + 1}`,
    values
  );
  return rows;
}
