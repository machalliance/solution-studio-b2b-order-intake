/**
 * @file index.js
 * @description Extraction provider factory. Selected via EXTRACTION_PROVIDER in .env.
 *
 * Interface contract - a replacement adapter must implement:
 * @module extraction
 */

/**
 * @typedef {Object} ExtractionAdapter
 * @property {function(
 *   content: string,
 *   context: { channel: string, contentType: string, senderEmail: string|null }
 * ): Promise<{
 *   order:           Object|null,
 *   confidenceScore: number,
 *   reasoning:       string
 * }>} extract - Parse free-form order content into a MACH ODM Order entity
 */

import { ClaudeExtractionProvider } from './claude.js';

export function createExtractionProvider() {
  const provider = process.env.EXTRACTION_PROVIDER || 'claude';
  switch (provider) {
    case 'claude': return new ClaudeExtractionProvider();
    default: throw new Error(`Unknown EXTRACTION_PROVIDER: "${provider}". Valid values: claude`);
  }
}
