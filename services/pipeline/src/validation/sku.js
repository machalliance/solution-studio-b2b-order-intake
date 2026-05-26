/**
 * @file sku.js
 * @description SKU resolution for each order line item. Uses a 2-step approach:
 *   1. Exact string match against the inventory catalogue (sku_id)
 *   2. AI fuzzy match using the configured resolver (claude by default)
 *
 * Resolution statuses (written to SkuResolution.status and line_items.sku_resolution_status):
 *   exact   - buyerSku matched an inventory sku_id directly; no AI needed
 *   auto    - AI match accepted automatically (confidence >= SKU_AUTO_THRESHOLD)
 *   review  - AI found likely matches (confidence >= SKU_REVIEW_THRESHOLD) but needs human confirmation
 *   clarify - AI confidence too low; buyer must confirm the correct SKU
 *
 * Confidence thresholds (all env-configurable):
 *   SKU_AUTO_THRESHOLD    (default 90) - accept AI match automatically
 *   SKU_REVIEW_THRESHOLD  (default 50) - surface candidates for human review
 *   SKU_FUZZY_ALWAYS_REVIEW (default false) - force review even above auto threshold
 *   SKU_MAX_CANDIDATES    (default 3) - maximum candidate SKUs to surface
 * @module validation/sku
 */
import { getInventoryItem, getInventoryCatalogue } from '../db/queries/inventory.js';
import { config } from '../config.js';

/**
 * Resolve each line item's buyerSku to an internal inventory sku_id.
 * Loads the full active catalogue once per call to avoid N+1 queries during AI resolution.
 *
 * @param {Object[]} lineItems - MACH ODM Order lineItems[] (lineNumber, buyerSku, quantity, ...)
 * @param {Object} resolver    - SKU resolver adapter (e.g. ClaudeSkuResolver)
 * @returns {Promise<import('../graph/state.js').SkuResolution[]>}
 */
export async function resolveSkus(lineItems, resolver) {
  const autoThresh    = config.SKU_AUTO_THRESHOLD;
  const reviewThresh  = config.SKU_REVIEW_THRESHOLD;
  const alwaysReview  = config.SKU_FUZZY_ALWAYS_REVIEW;
  const maxCandidates = config.SKU_MAX_CANDIDATES;

  // Load the full active catalogue once - passed to the AI resolver for all lines.
  // The catalogue is shared across all parallel resolutions (read-only).
  const catalogue = await getInventoryCatalogue();

  // Resolve all lines in parallel - Claude calls are I/O bound so concurrent
  // execution cuts wall-clock time from O(n) sequential calls to O(1) fan-out.
  return Promise.all(lineItems.map(async (line) => {
    // -- Step 1: exact match --------------------------------------------------
    const exact = await getInventoryItem(line.buyerSku);
    if (exact) {
      return {
        lineNumber:    line.lineNumber,
        buyerSku:      line.buyerSku,
        quantity:      line.quantity,
        resolvedSkuId: exact.sku_id,
        status:        'exact',
        candidates:    [],
        aiReasoning:   '',
        fuzzyMatched:  false,
      };
    }

    // -- Step 2: AI fuzzy match -----------------------------------------------
    const aiResult = await resolver.resolve(
      line.buyerSku,
      line.productDescription || '',
      catalogue
    );

    const matches     = (aiResult.matches || []).slice(0, maxCandidates);
    const best        = matches[0];
    const aiReasoning = matches.map(m => `${m.skuId}: ${m.reasoning} (${m.confidence}%)`).join(' | ');

    if (best && !alwaysReview && best.confidence >= autoThresh) {
      return {
        lineNumber:    line.lineNumber,
        buyerSku:      line.buyerSku,
        quantity:      line.quantity,
        resolvedSkuId: best.skuId,
        status:        'auto',
        candidates:    matches,
        aiReasoning,
        fuzzyMatched:  true,
      };
    } else if (best && best.confidence >= reviewThresh) {
      return {
        lineNumber:    line.lineNumber,
        buyerSku:      line.buyerSku,
        quantity:      line.quantity,
        resolvedSkuId: null,
        status:        'review',
        candidates:    matches,
        aiReasoning,
        fuzzyMatched:  true,
      };
    } else {
      return {
        lineNumber:    line.lineNumber,
        buyerSku:      line.buyerSku,
        quantity:      line.quantity,
        resolvedSkuId: null,
        status:        'clarify',
        candidates:    matches,
        aiReasoning,
        fuzzyMatched:  !!best,
      };
    }
  }));
}
