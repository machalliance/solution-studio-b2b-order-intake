/**
 * @file index.js
 * @description SKU resolver factory. The active resolver is selected via the
 *              SKU_RESOLVER environment variable - enables swapping the AI backend
 *              without code changes (Cloud-native / MACH-C).
 *
 * Interface contract - a replacement adapter must implement:
 * @module sku
 */

/**
 * @typedef {Object} SkuResolverAdapter
 * @property {function(
 *   buyerSku:    string,
 *   description: string,
 *   catalogue:   Array<{sku_id:string, description:string, [key:string]:any}>
 * ): Promise<{
 *   matches: Array<{skuId:string, confidence:number, reasoning:string}>
 * }>} resolve - Fuzzy-match a buyer SKU string against the active inventory catalogue
 */

import { ClaudeSkuResolver } from './claude.js';

/**
 * Instantiate and return the configured SKU resolver.
 * @returns {SkuResolverAdapter}
 * @throws {Error} if SKU_RESOLVER is set to an unknown value
 */
export function createSkuResolver() {
  const provider = process.env.SKU_RESOLVER || 'claude';
  switch (provider) {
    case 'claude': return new ClaudeSkuResolver();
    default: throw new Error(`Unknown SKU_RESOLVER: "${provider}". Valid values: claude`);
  }
}
