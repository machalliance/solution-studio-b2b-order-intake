/**
 * @file business-rules.js
 * @description Required field validation per the MACH ODM Order entity spec.
 *              Produces structured error codes used by the routing node to determine
 *              the appropriate outcome (clarify, review, reject).
 *
 * Error code format:
 *   - 'no_order_extracted'              - null/empty order
 *   - 'missing_<field>'                 - order-level field absent (e.g. 'missing_poNumber')
 *   - 'missing_<nested>_<field>'        - nested path absent (e.g. 'missing_buyer_email')
 *   - 'line_<n>_missing_<field>'        - line item field absent (1-based line number)
 *   - 'too_many_line_items_max_<n>'     - line count exceeds MAX_LINE_ITEMS
 * @module validation/business-rules
 */

/**
 * MACH ODM Order required fields. Array entries are dot-paths (nested).
 * Optional fields (currency, shippingAddress, requestedDeliveryDate, etc.) are
 * intentionally excluded - the extraction AI handles them gracefully.
 */
const REQUIRED_ORDER_FIELDS = ['poNumber', 'orderDate', ['buyer', 'email']];

/**
 * MACH ODM lineItems[] minimum required fields per line.
 * unitPrice and unitOfMeasure are optional - buyers sometimes omit pricing.
 */
const REQUIRED_LINE_FIELDS  = ['lineNumber', 'buyerSku', 'quantity'];

import { config } from '../config.js';

/**
 * Validate required MACH ODM Order fields and line item completeness.
 * @param {Object|null} order - extractedOrder from state (MACH ODM Order entity shape)
 * @returns {{ errors: string[] }} structured error codes for the routing node
 */
export function validateBusinessRules(order) {
  const errors = [];
  if (!order) { errors.push('no_order_extracted'); return { errors }; }

  // -- Order-level required fields -------------------------------------------
  for (const field of REQUIRED_ORDER_FIELDS) {
    const path  = Array.isArray(field) ? field : [field];
    const value = path.reduce((o, k) => o?.[k], order);
    // Error code uses underscores for nested paths: ['buyer','email'] -> 'missing_buyer_email'
    if (!value) errors.push(`missing_${path.join('_')}`);
  }

  // -- Line item validation --------------------------------------------------
  const maxLineItems = config.MAX_LINE_ITEMS;
  const lines = order.lineItems || [];

  // A new_order with zero line items cannot be processed - flag it.
  // Cancellations and amendments legitimately have no lines, but those are
  // caught by documentType routing before business rules matter.
  if (lines.length === 0 && order.documentType === 'new_order') {
    errors.push('no_line_items');
  }

  // Guard against malformed documents that produce hundreds of phantom line items
  if (lines.length > maxLineItems) {
    errors.push(`too_many_line_items_max_${maxLineItems}`);
  }

  for (const [i, line] of lines.entries()) {
    for (const field of REQUIRED_LINE_FIELDS) {
      // Use 1-based line number in the error code to match MACH ODM lineNumber convention
      if (!line[field]) errors.push(`line_${i + 1}_missing_${field}`);
    }

    // Detect explicitly zero unit prices. null/undefined means the buyer omitted pricing
    // (handled by SKU resolution / clarify path); Number(0) means they sent $0.00 which
    // is suspicious and routed per the ZERO_PRICE_ACTION policy.
    if (line.unitPrice !== null && line.unitPrice !== undefined && Number(line.unitPrice) === 0) {
      errors.push(`line_${i + 1}_zero_unit_price`);
    }
  }

  return { errors };
}
