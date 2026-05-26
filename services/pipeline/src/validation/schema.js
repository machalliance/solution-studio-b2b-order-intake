/**
 * @file schema.js
 * @description AJV schemas for order validation.
 * @module validation/schema
 */
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

const lineItemSchema = {
  type: 'object',
  required: ['line_number', 'buyer_sku', 'quantity'],
  properties: {
    line_number:         { type: 'integer', minimum: 1 },
    buyer_sku:           { type: 'string', minLength: 1 },
    product_description: { type: 'string' },
    quantity:            { type: 'number', exclusiveMinimum: 0 },
    unit_of_measure:     { type: 'string' },
    unit_price:          { type: 'number', minimum: 0 },
  },
};

const orderSchema = {
  type: 'object',
  required: ['po_number', 'line_items'],
  properties: {
    po_number:               { type: 'string', minLength: 1 },
    order_date:              { type: 'string' },
    requested_delivery_date: { type: 'string' },
    buyer_company:           { type: 'string' },
    buyer_email:             { type: 'string' },
    currency:                { type: 'string' },
    line_items: {
      type: 'array',
      minItems: 1,
      items: lineItemSchema,
    },
  },
};

const validateOrder = ajv.compile(orderSchema);

/**
 * Validates an extracted order against the MACH ODM Order schema.
 * @param {Object} order
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSchema(order) {
  const valid = validateOrder(order);
  if (valid) return { valid: true, errors: [] };
  const errors = (validateOrder.errors || []).map(
    e => `${e.instancePath || 'order'} ${e.message}`
  );
  return { valid: false, errors };
}
