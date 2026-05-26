/**
 * @file erp.js
 * @description Database queries for the erp_submissions table.
 *              Persistence of ERP submission records is the pipeline's concern -
 *              ERP adapters return only the ERP response and never touch this table.
 * @module db/queries/erp
 */
import pool from '../pool.js';

/**
 * Persist a completed ERP submission.
 * Called by the submit node (auto-submit) and the review approve handler (operator submit)
 * after the ERP adapter has accepted the order.
 *
 * @param {string} erpOrderId - ERP-assigned order ID from the adapter response
 * @param {Object} payload    - full MACH ODM Order payload sent to the ERP
 * @returns {Promise<Object>} created erp_submissions row
 */
export async function recordErpSubmission(erpOrderId, payload) {
  const { rows } = await pool.query(
    `INSERT INTO erp_submissions (erp_order_id, payload, submitted_at)
     VALUES ($1, $2, NOW())
     RETURNING *`,
    [erpOrderId, JSON.stringify(payload)]
  );
  return rows[0];
}

/**
 * List all ERP submissions, most recent first.
 * Extracts key MACH ODM fields from the JSONB payload for the list view.
 *
 * @returns {Promise<Object[]>}
 */
export async function listErpSubmissions() {
  const { rows } = await pool.query(
    `SELECT erp_order_id, status, submitted_at,
            payload->>'poNumber'                    AS po_number,
            payload->'customer'->>'company_name'    AS company_name,
            payload->'buyer'->>'companyName'        AS buyer_company,
            payload                                 AS payload
     FROM erp_submissions
     ORDER BY submitted_at DESC`
  );
  return rows;
}

/**
 * Fetch a single ERP submission by its ERP-assigned order ID.
 *
 * @param {string} erpOrderId
 * @returns {Promise<Object|null>}
 */
export async function getErpSubmission(erpOrderId) {
  const { rows } = await pool.query(
    'SELECT * FROM erp_submissions WHERE erp_order_id = $1',
    [erpOrderId]
  );
  return rows[0] || null;
}
