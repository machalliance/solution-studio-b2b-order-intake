/**
 * @file claude.js
 * @description Claude-powered SKU resolver. Given a buyer's product reference and description,
 *              finds the best matching SKUs from the active inventory catalogue.
 *              Called by validation/sku.js when an exact string match fails.
 * @module sku/claude
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { config }        from '../config.js';
import { withRetry }     from '../util/retry.js';

export class ClaudeSkuResolver {
  constructor() {
    this.model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model:  process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    });
  }

  /**
   * Match a buyer SKU string to the internal inventory catalogue using AI.
   * Only sku_id and description are sent - no pricing or stock data to minimise prompt size.
   *
   * @param {string}   buyerSku    - the buyer's product reference from the order line
   * @param {string}   description - product description from the order line (may be empty)
   * @param {Object[]} catalogue   - active inventory rows (MACH ODM Inventory entity shape)
   * @returns {Promise<{ matches: Array<{skuId:string, confidence:number, reasoning:string}> }>}
   *   confidence is 0-100; matches are ordered by descending confidence
   */
  async resolve(buyerSku, description, catalogue) {
    const maxCandidates = config.SKU_MAX_CANDIDATES;
    const prompt = `Match this buyer SKU to the inventory catalogue.
Buyer SKU: ${buyerSku}
Description: ${description || 'none provided'}
Catalogue: ${JSON.stringify(catalogue.map(i => ({ skuId: i.sku_id, description: i.description })))}
Return JSON: { matches: [{ skuId, confidence, reasoning }] } top ${maxCandidates} only.
JSON only, no markdown.`;

    try {
      const response = await withRetry(
        () => this.model.invoke([{ role: 'user', content: prompt }]),
        { label: `sku-resolve(${buyerSku})`, maxAttempts: config.AI_RETRY_MAX_ATTEMPTS, baseDelayMs: config.AI_RETRY_BASE_DELAY_MS }
      );
      const raw = typeof response.content === 'string' ? response.content : response.content[0]?.text || '{}';
      const match = raw.match(/\{[\s\S]*\}/);
      return JSON.parse(match ? match[0] : '{}');
    } catch {
      // All retry attempts exhausted or parse error - return empty matches so the
      // caller falls through to 'clarify' status rather than silently dropping the line
      return { matches: [] };
    }
  }
}
