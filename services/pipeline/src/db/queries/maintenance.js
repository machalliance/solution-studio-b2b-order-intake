/**
 * @file maintenance.js
 * @description Database maintenance queries - test data reset and health checks.
 *              These are the only queries that perform destructive operations.
 *              The clearAllTestData function should never be called in production
 *              (guarded by ENABLE_TEST_ENDPOINTS in the API layer).
 * @module db/queries/maintenance
 */
import pool from '../pool.js';

/**
 * Truncate all pipeline tables and reset their identity sequences.
 * Used by POST /api/test/clear to wipe all test data between runs.
 * CASCADE ensures foreign-key dependent rows are removed in one statement.
 *
 * @returns {Promise<void>}
 */
export async function clearAllTestData() {
  await pool.query(`
    TRUNCATE TABLE erp_submissions, line_items, audit_log, orders
    RESTART IDENTITY CASCADE
  `);
  // Clear LangGraph checkpointer state so resumed graphs from previous test
  // runs cannot interfere with a fresh test session.
  await pool.query(`
    TRUNCATE TABLE checkpoints, checkpoint_blobs, checkpoint_writes
  `).catch(() => {
    // Tables may not exist yet if no order has been reviewed - safe to ignore
  });
}

/**
 * Minimal liveness check - verifies the pool can reach the database.
 * Used by GET /api/health/all.
 *
 * @returns {Promise<void>} resolves if reachable, throws if not
 */
export async function dbPing() {
  await pool.query('SELECT 1');
}
