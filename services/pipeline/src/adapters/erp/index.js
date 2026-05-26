/**
 * @file index.js
 * @description ERP adapter factory. Selected via ERP_ADAPTER in .env.
 *
 * Interface contract - a replacement adapter must implement:
 * @module adapters/erp
 */

/**
 * @typedef {Object} ERPAdapter
 * @property {function(Object): Promise<{
 *   orderId:     string,
 *   status:      string,
 *   submittedAt: string
 * }>} submitOrder - Submit a MACH ODM Order entity (with resolved SKUs and customer) to the ERP
 */

import { StubERPAdapter } from './stub.js';

export function createERPAdapter() {
  const provider = process.env.ERP_ADAPTER || 'stub';
  switch (provider) {
    case 'stub': return new StubERPAdapter();
    default: throw new Error(`Unknown ERP_ADAPTER: "${provider}". Valid values: stub`);
  }
}
