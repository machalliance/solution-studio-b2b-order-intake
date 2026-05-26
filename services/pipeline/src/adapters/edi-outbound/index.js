/**
 * @file index.js
 * @description EDI outbound adapter factory. Selected via EDI_OUTBOUND_PROVIDER in .env.
 *
 * Interface contract - a replacement adapter must implement:
 * @module adapters/edi-outbound
 */

/**
 * @typedef {Object} EdiOutboundAdapter
 * @property {function(
 *   type:     '864'|'855',
 *   poNumber: string|null,
 *   content:  string
 * ): Promise<string>} send - Transmit an outbound X12 document and return a
 *   destination reference (filename, message ID, tracking number, etc.)
 *
 * Implementations:
 *   file  - writes to EDI_OUTBOUND_PATH directory (default, for file-transfer setups)
 *   van   - POST to a Value Added Network API (future)
 *   as2   - AS2 direct transmission to trading partner (future)
 */

import { FileEdiOutboundAdapter } from './file.js';

export function createEdiOutboundAdapter() {
  const provider = process.env.EDI_OUTBOUND_PROVIDER || 'file';
  switch (provider) {
    case 'file': return new FileEdiOutboundAdapter();
    default: throw new Error(`Unknown EDI_OUTBOUND_PROVIDER: "${provider}". Valid values: file`);
  }
}
