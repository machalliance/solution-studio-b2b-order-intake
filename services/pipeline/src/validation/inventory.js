/**
 * @file inventory.js
 * @description Inventory availability checks against the MACH ODM Inventory entity.
 *              Produces error codes used by the routing node to determine whether
 *              an order can be auto-submitted or needs operator review.
 *
 * Outcome codes produced (per line):
 *   'line_<n>_sku_inactive'         - SKU exists but is not active (Inventory.active = false)
 *   'line_<n>_out_of_stock'         - insufficient qty and not backorderable
 *   'line_<n>_backorder_needs_review' - backorderable but BACKORDER_AUTO_SUBMIT=false
 *
 * Backorders that are auto-approved (BACKORDER_AUTO_SUBMIT=true) produce no error
 * code - they go to submit with backorder flags set on the line items.
 * @module validation/inventory
 */
import { checkAvailability } from '../db/queries/inventory.js';

/**
 * Check inventory availability for all resolved SKU line items.
 * Skips lines where the SKU could not be resolved - those are handled by the routing node.
 *
 * @param {import('../graph/state.js').SkuResolution[]} skuResolutions
 * @returns {Promise<{ issues: string[], backorders: Array<{lineNumber:number, backorderEta:Date|null}> }>}
 */
export async function checkInventory(skuResolutions) {
  const issues     = [];
  const backorders = [];

  for (const res of skuResolutions) {
    // Lines without a resolvedSkuId are already flagged by SKU resolution status;
    // running an inventory check on a null SKU would always return 'not_found'
    if (!res.resolvedSkuId) continue;

    const avail = await checkAvailability(res.resolvedSkuId, res.quantity || 1);

    if (avail.outcome === 'inactive') {
      // SKU is discontinued - operator must substitute or reject
      issues.push(`line_${res.lineNumber}_sku_inactive`);
    } else if (!avail.pass && avail.outcome === 'out_of_stock') {
      // Insufficient stock and item is not backorderable
      issues.push(`line_${res.lineNumber}_out_of_stock`);
    } else if (!avail.pass && avail.outcome === 'backorder_review') {
      // Backorderable but BACKORDER_AUTO_SUBMIT=false - operator must confirm lead time with buyer
      issues.push(`line_${res.lineNumber}_backorder_needs_review`);
    }

    // Record backorder lines regardless of auto-submit setting so the submit node
    // can write backorder_flag and backorder_eta to line_items
    if (avail.backorder) {
      backorders.push({ lineNumber: res.lineNumber, backorderEta: avail.backorderEta });
    }
  }

  return { issues, backorders };
}
