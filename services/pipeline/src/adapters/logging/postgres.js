/**
 * @file postgres.js
 * @description PostgreSQL audit logging adapter. Wraps writeAuditEvent from the DB
 *              queries layer so graph nodes can call adapters.logging.writeEvent()
 *              without importing DB modules directly - keeping node code decoupled
 *              from the persistence implementation (Microservices / MACH-M).
 * @module adapters/logging/postgres
 */
import { writeAuditEvent } from '../../db/queries/audit.js';

export class PostgresLoggingAdapter {
  /**
   * Writes a pipeline event to the audit_log table.
   * @param {Object} event
   * @param {string}  event.orderId         - UUID of the order
   * @param {string}  event.eventType       - e.g. 'intake', 'extraction', 'routing', 'error'
   * @param {string}  [event.channel]       - 'email' | 'edi'
   * @param {string}  [event.outcome]       - 'clarify' | 'reject' | 'review' | 'submit'
   * @param {number}  [event.confidenceScore] - 0-100
   * @param {string}  [event.aiReasoning]   - AI explanation string
   * @param {Array}   [event.candidates]    - customer or SKU candidates
   * @param {Object}  [event.metadata]      - free-form extra data
   * @returns {Promise<Object>} created audit_log row
   */
  async writeEvent(event) {
    return writeAuditEvent(event);
  }
}
