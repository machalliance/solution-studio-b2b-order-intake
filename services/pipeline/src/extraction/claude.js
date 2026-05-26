/**
 * @file claude.js
 * @description Claude extraction provider using @langchain/anthropic.
 *              Calls the Claude API to parse free-form order content into a structured
 *              MACH ODM Order entity with a self-assessed confidence score.
 *
 * The extraction prompt (EXTRACTION_PROMPT constant below) encodes the full MACH ODM
 * Order entity schema, confidence scoring rules, and document classification logic.
 * Prompt changes must be tested against the full test corpus before deployment.
 * @module extraction/claude
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { config }        from '../config.js';
import { withRetry }     from '../util/retry.js';
import { logger }        from '../util/logger.js';

const EXTRACTION_PROMPT = `You are a B2B purchase order extraction system.

Extract all available order information from the following content and return a JSON object.
The JSON must conform to the MACH Alliance Open Data Model Order entity structure.

REQUIRED fields - deduct significantly if absent or ambiguous:
- poNumber: string
- orderDate: ISO date string (convert from any unambiguous format, e.g. YYYYMMDD); if no date is stated but the document is clearly a new order (e.g. "same as last month", "please send again"), use today's date and do NOT deduct confidence for this inference
- buyer.email: string
- lineItems[].lineNumber, lineItems[].buyerSku, lineItems[].quantity

OPTIONAL fields - extract if present, do NOT deduct if absent:
- buyer.accountId: string or null
- buyer.companyName: string or null
- buyer.phone: string or null
- buyer.address: { street, city, state, postalCode, country } or null
- shippingAddress: { street, city, state, postalCode, country } or null
- requestedDeliveryDate: ISO date string or null

CURRENCY rules:
- US address or unambiguous US state code present -> currency: "USD", no deduction
- Canadian address or province code present -> currency: "CAD", no deduction
- Country identified but neither US nor CA, and currency unstated -> currency: null, flag as uncertain
- No address context and currency unstated -> currency: null, flag as uncertain

LINE ITEM rules:
- Do NOT include lineTotal - calculated downstream, never extract it
- If a line number appears with conflicting values, return ALL versions as separate entries
  with the same lineNumber - never collapse to a single null placeholder

CONFIDENCE SCORE - do NOT deduct for:
- Country derived from an unambiguous US state or Canadian province abbreviation
- Currency inferred as USD/CAD per the currency rules above
- Arithmetic results (quantity x unit price, etc.)
- Standard address/date formatting normalisation
- Sender email absent when channel is EDI, CSV, or structured file - expected and normal
- Any of the OPTIONAL fields listed above being absent

CONFIDENCE SCORE - DO deduct for:
- Any REQUIRED field absent or ambiguous
- Line item quantity, SKU, or line number absent or conflicting
- Genuine multi-value ambiguity with no resolution (e.g. two conflicting order dates)
- Data that appears invalid or placeholder (e.g. state "XX", ZIP "00000", name "Unknown Corp")
- Currency unknown when no address context exists to infer it

Also return:
- documentType: classify the intent of this document. Must be exactly one of:
    "new_order"    - a fresh purchase order (default)
    "repeat_order" - explicitly repeats or references a previous order ("same as last month", "repeat of PO-XXXX", "send the usual")
    "amendment"    - modifies an existing PO ("please change", "amend", "revise", "increase qty on PO-XXXX")
    "cancellation" - cancels an existing PO ("please cancel", "we no longer need")
    "inquiry"      - a legitimate business question or request (stock check, lead time, quote request, general correspondence)
    "spam"         - unsolicited marketing, newsletters, automated promotional email
    "bec"          - Business Email Compromise or phishing: impersonates a vendor/executive, requests payment redirection, asks for banking credentials, wire transfers, or gift cards; may look like a PO but contains financial fraud signals
  Rules:
  - Only use repeat_order or amendment when the document explicitly and unambiguously states it. If in doubt, use new_order.
  - Prefer bec over spam when the email is deliberately deceptive or requests financial action.
  - Use inquiry only for genuine business questions, not junk mail.
  - Mark as spam any promotional, marketing, newsletter, or deal/discount email (e.g. "HUGE SAVINGS", "limited time offer", "unsubscribe", "click here"). These are never orders.
  - If uncertain between new_order and spam/inquiry, look for the presence of a PO number, line items, and a buyer identity. Without these, it is not a new_order.

- confidenceScore: integer 0-100
- reasoning: structured explanation using this exact format:
  Line 1: One sentence summary of overall extraction quality.
  Line 2+: "Issues:" followed by a bullet for each item that actually reduced the score (omit this section entirely if score is 95+).
  Final line: "Confidence: <score>% - <one phrase explaining the main factor>."

Return ONLY valid JSON. No markdown, no preamble.`;

export class ClaudeExtractionProvider {
  constructor() {
    this.model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model:  process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    });
  }

  /**
   * Extract structured MACH ODM Order entity from raw order content.
   * @param {string} content    - fully parsed order text from the intake node
   * @param {Object} context
   * @param {string} context.channel      - 'email' | 'edi' (informs confidence rules)
   * @param {string} context.contentType  - 'plain_text'|'pdf'|'csv'|'xlsx'|'x12_850'
   * @param {string|null} context.senderEmail - passed as context; absent for EDI is expected
   * @returns {Promise<{ order: Object, confidenceScore: number, reasoning: string }>}
   *   order conforms to MACH ODM Order entity shape (poNumber, orderDate, buyer, lineItems, etc.)
   */
  async extract(content, context) {
    const response = await withRetry(
      () => this.model.invoke([
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user',   content: `Order content:\n\n${content}\n\nSender email: ${context.senderEmail || 'unknown'}` },
      ]),
      { label: 'extraction', maxAttempts: config.AI_RETRY_MAX_ATTEMPTS, baseDelayMs: config.AI_RETRY_BASE_DELAY_MS }
    );

    let parsed;
    try {
      const raw = typeof response.content === 'string'
        ? response.content
        : response.content[0]?.text || '{}';
      // The prompt instructs Claude to return plain JSON, but strip code fences defensively
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON object in response');
      parsed = JSON.parse(match[0]);
    } catch (err) {
      logger.error({ err }, 'Extraction parse error');
      return { order: {}, confidenceScore: 0, reasoning: 'Failed to parse extraction response' };
    }

    return {
      order:           parsed,
      // Clamp to 0-100 and default to 0 - never trust an unvalidated AI-provided integer
      confidenceScore: Math.min(100, Math.max(0, parseInt(parsed.confidenceScore) || 0)),
      reasoning:       parsed.reasoning || '',
    };
  }
}
