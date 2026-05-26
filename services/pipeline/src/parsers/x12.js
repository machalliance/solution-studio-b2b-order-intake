/**
 * @file x12.js
 * @description X12 850 EDI purchase order parser using node-x12 (MIT).
 * @module parsers/x12
 */
import { X12Parser as NodeX12Parser } from 'node-x12';

export class X12Parser {
  get supportedTypes() { return ['.edi', 'application/edi-x12']; }

  /**
   * @param {Object} message
   * @returns {Promise<{text: string, contentType: string, structured: Object}>}
   */
  async parse(message) {
    const raw = message.content?.toString('utf8') || message.body || '';
    const parser = new NodeX12Parser();
    const interchange = parser.parse(raw);

    // Extract PO data from the 850 transaction set
    const lines = [];
    const orderInfo = {};

    for (const group of interchange.functionalGroups || []) {
      for (const tx of group.transactions || []) {
        for (const segment of tx.segments || []) {
          if (segment.tag === 'BEG') {
            orderInfo.poNumber  = segment.valueOf(3); // BEG03
            orderInfo.orderDate = segment.valueOf(5); // BEG05
          }
          if (segment.tag === 'PO1') {
            lines.push({
              lineNumber:     lines.length + 1,
              quantity:       segment.valueOf(2), // PO102
              unitOfMeasure:  segment.valueOf(3), // PO103
              unitPrice:      segment.valueOf(4), // PO104
              buyerSku:       segment.valueOf(7) || segment.valueOf(9), // PO107 or PO109
            });
          }
          if (segment.tag === 'N1' && segment.valueOf(1) === 'BY') { // N101 = 'BY' (Buying Party)
            orderInfo.buyerName = segment.valueOf(2); // N102
          }
          if (segment.tag === 'N3') {
            orderInfo.buyerAddress = segment.valueOf(1); // N301
          }
          if (segment.tag === 'N4') {
            orderInfo.buyerCity  = segment.valueOf(1); // N401
            orderInfo.buyerState = segment.valueOf(2); // N402
            orderInfo.buyerZip   = segment.valueOf(3); // N403
          }
        }
      }
    }

    // Build text representation for Claude extraction
    const text = [
      `PO Number: ${orderInfo.poNumber || 'unknown'}`,
      `Order Date: ${orderInfo.orderDate || 'unknown'}`,
      `Buyer: ${orderInfo.buyerName || 'unknown'}`,
      `Address: ${[orderInfo.buyerAddress, orderInfo.buyerCity, orderInfo.buyerState, orderInfo.buyerZip].filter(Boolean).join(', ')}`,
      '',
      'Line Items:',
      ...lines.map(l =>
        `  Line ${l.lineNumber}: SKU=${l.buyerSku}, Qty=${l.quantity} ${l.unitOfMeasure}, Price=${l.unitPrice}`
      ),
    ].join('\n');

    return { text, contentType: 'x12_850', structured: { ...orderInfo, lines } };
  }
}
