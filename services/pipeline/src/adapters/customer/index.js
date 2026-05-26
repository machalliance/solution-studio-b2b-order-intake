/**
 * @file index.js
 * @description Customer lookup adapter factory. Selected via CUSTOMER_LOOKUP in .env.
 *
 * Interface contract - a replacement adapter must implement:
 * @module adapters/customer
 */

/**
 * @typedef {Object} CustomerLookupAdapter
 * @property {function({
 *   accountId?:   string,
 *   email?:       string,
 *   phone?:       string,
 *   companyName?: string,
 *   address?:     Object
 * }): Promise<{
 *   customer:     Object|null,
 *   candidates:   Array<{account_id:string, confidence:number, reasoning:string}>,
 *   fuzzyMatched: boolean,
 *   aiReasoning:  string
 * }>} lookup - Resolve buyer criteria to a known MACH ODM Customer entity via 5-step cascade
 */

import { JsonCustomerLookupAdapter } from './json.js';

export function createCustomerLookupAdapter() {
  const provider = process.env.CUSTOMER_LOOKUP || 'json';
  switch (provider) {
    case 'json': return new JsonCustomerLookupAdapter();
    default: throw new Error(`Unknown CUSTOMER_LOOKUP: "${provider}". Valid values: json`);
  }
}
