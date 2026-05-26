/**
 * @file index.js
 * @description Logging adapter factory. Selected via LOGGING_ADAPTER in .env.
 *
 * Interface contract - a replacement adapter must implement:
 * @module adapters/logging
 */

/**
 * @typedef {Object} LoggingAdapter
 * @property {function({
 *   orderId:          string,
 *   eventType:        string,
 *   channel?:         string,
 *   outcome?:         string,
 *   confidenceScore?: number,
 *   aiReasoning?:     string,
 *   candidates?:      Array,
 *   metadata?:        Object
 * }): Promise<Object>} writeEvent - Persist a pipeline audit event to the backing store
 */

import { PostgresLoggingAdapter } from './postgres.js';

export function createLoggingAdapter() {
  const provider = process.env.LOGGING_ADAPTER || 'postgres';
  switch (provider) {
    case 'postgres': return new PostgresLoggingAdapter();
    default: throw new Error(`Unknown LOGGING_ADAPTER: "${provider}". Valid values: postgres`);
  }
}
