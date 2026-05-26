/**
 * @file file.js
 * @description File-based EDI outbound adapter. Writes X12 documents to the
 *              configured edi-outbound directory for pickup by a file transfer
 *              process, EDI translator, or manual review.
 *
 * In production this would be replaced by a VAN (Value Added Network) adapter,
 * an AS2 transmission adapter, or a message queue adapter - all implementing
 * the same EdiOutboundAdapter.send() interface.
 * @module adapters/edi-outbound/file
 */
import { writeEdiOutbound } from '../../edi/generate.js';

export class FileEdiOutboundAdapter {
  /**
   * Write an outbound X12 document to the edi-outbound directory.
   * @param {'864'|'855'} type      - X12 transaction set type
   * @param {string|null}  poNumber - PO number used in the filename
   * @param {string}       content  - complete X12 document string
   * @returns {Promise<string>} filename written (without path)
   */
  async send(type, poNumber, content) {
    return writeEdiOutbound(type, poNumber, content);
  }
}
