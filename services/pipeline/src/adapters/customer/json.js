/**
 * @file json.js
 * @description JSON file-based customer lookup adapter. Implements a 5-step identity
 *              resolution cascade against a static customers.json catalogue.
 *
 * Cascade order (stops at first match):
 *   1. Exact account_id match          (MACH ODM: Customer.account_id)
 *   2. Email domain or contact email   (MACH ODM: Customer.email_domains, contact_emails)
 *   3. Phone number (E.164 normalised) (MACH ODM: Customer.phone_numbers)
 *   4. AI fuzzy match on company name + address (MACH ODM: Customer.company_name, address)
 *   5. No match - returns null customer with empty candidates
 *
 * Confidence thresholds for step 4 (all env-configurable):
 *   CUSTOMER_AUTO_THRESHOLD   (default 90) - auto-accept fuzzy match
 *   CUSTOMER_REVIEW_THRESHOLD (default 60) - return as candidates for human review
 *   CUSTOMER_FUZZY_ALWAYS_REVIEW (default false) - force review even above auto threshold
 *
 * MACH ODM: Customer entity fields used from catalogue:
 *   account_id, company_name, email_domains, contact_emails, phone_numbers, address
 * @module adapters/customer/json
 */
import { readFile }      from 'fs/promises';
import { ChatAnthropic } from '@langchain/anthropic';
import { config }        from '../../config.js';
import { withRetry }     from '../../util/retry.js';
import { logger }        from '../../util/logger.js';

export class JsonCustomerLookupAdapter {
  constructor() {
    // Lazy-loaded on first lookup - avoids blocking startup if the file is slow to mount
    this._customers = null;
    this.model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model:  process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    });
  }

  /**
   * Load and cache the customers catalogue from the bind-mounted config file.
   * @returns {Promise<Object[]>} array of MACH ODM Customer entities
   */
  async _load() {
    if (this._customers) return this._customers;
    const raw = await readFile('/app/config/customers.json', 'utf8');
    this._customers = JSON.parse(raw).customers;
    return this._customers;
  }

  /**
   * Resolve a buyer to a known customer using the 5-step cascade.
   * @param {{ accountId?: string, email?: string, phone?: string, companyName?: string, address?: Object }} criteria
   *   Buyer fields from the MACH ODM Order.buyer object, plus senderEmail fallback.
   * @returns {Promise<{
   *   customer: Object|null,       - matched MACH ODM Customer entity, or null
   *   candidates: Object[],        - top AI matches (account_id, confidence, reasoning)
   *   fuzzyMatched: boolean,       - true if AI matching was used
   *   aiReasoning: string          - human-readable AI match summary
   * }>}
   */
  async lookup(criteria) {
    const customers = await this._load();
    const autoThresh   = config.CUSTOMER_AUTO_THRESHOLD;
    const reviewThresh = config.CUSTOMER_REVIEW_THRESHOLD;
    const alwaysReview = config.CUSTOMER_FUZZY_ALWAYS_REVIEW;

    // -- Step 1: exact account_id ---------------------------------------------
    if (criteria.accountId) {
      const match = customers.find(c => c.account_id === criteria.accountId);
      if (match) return { customer: match, candidates: [], fuzzyMatched: false, aiReasoning: '' };
    }

    // -- Step 2: email domain or contact email --------------------------------
    // Matches either the full address (contact_emails) or just the domain (email_domains).
    // senderEmail (envelope From) is used as a fallback when buyer.email is absent.
    if (criteria.email) {
      const domain = criteria.email.split('@')[1];
      const match = customers.find(c =>
        c.email_domains?.includes(domain) ||
        c.contact_emails?.includes(criteria.email)
      );
      if (match) return { customer: match, candidates: [], fuzzyMatched: false, aiReasoning: '' };
    }

    // -- Step 3: phone number -------------------------------------------------
    // Strip all non-digits before comparing so format differences don't cause misses
    if (criteria.phone) {
      const normalised = criteria.phone.replace(/\D/g, '');
      const match = customers.find(c =>
        c.phone_numbers?.some(p => p.replace(/\D/g, '') === normalised)
      );
      if (match) return { customer: match, candidates: [], fuzzyMatched: false, aiReasoning: '' };
    }

    // -- Step 4: AI fuzzy match -----------------------------------------------
    // Only runs when company name or address is available - without these the AI
    // has nothing to match against.
    if (criteria.companyName || criteria.address) {
      // Send only the fields needed for matching - avoid sending PII unnecessarily
      const catalogue = customers.map(c => ({
        account_id:   c.account_id,
        company_name: c.company_name,
        address:      c.address,
      }));

      const maxCandidates = config.CUSTOMER_MAX_CANDIDATES;
      const prompt = `Match this buyer to one of the known customers.
Buyer: ${criteria.companyName || ''}, ${JSON.stringify(criteria.address || {})}
Known customers: ${JSON.stringify(catalogue)}
Return JSON: { matches: [{ account_id, confidence, reasoning }] } top ${maxCandidates} matches only.
No markdown, no preamble. JSON only.`;

      try {
        const response = await withRetry(
          () => this.model.invoke([{ role: 'user', content: prompt }]),
          { label: `customer-lookup(${criteria.companyName || 'unknown'})`, maxAttempts: config.AI_RETRY_MAX_ATTEMPTS, baseDelayMs: config.AI_RETRY_BASE_DELAY_MS }
        );
        const raw = typeof response.content === 'string' ? response.content : response.content[0]?.text || '{}';
        const match = raw.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(match ? match[0] : '{}');
        const matches = (parsed.matches || []).slice(0, maxCandidates);

        if (matches.length > 0) {
          const best = matches[0];
          const fullCustomer = customers.find(c => c.account_id === best.account_id);
          // Flatten reasoning to a single string for the audit log
          const aiReasoning  = matches.map(m => `${m.account_id}: ${m.reasoning} (${m.confidence}%)`).join(' | ');

          if (!alwaysReview && best.confidence >= autoThresh && fullCustomer) {
            // High-confidence match - auto-accept, no operator review needed
            return { customer: fullCustomer, candidates: matches, fuzzyMatched: true, aiReasoning };
          }
          if (best.confidence >= reviewThresh) {
            // Medium-confidence - surface candidates to operator via human review queue
            return { customer: null, candidates: matches, fuzzyMatched: true, aiReasoning };
          }
        }
      } catch (err) {
        logger.error({ err }, 'Customer fuzzy match error');
      }
    }

    // -- Step 5: no match -----------------------------------------------------
    return { customer: null, candidates: [], fuzzyMatched: false, aiReasoning: '' };
  }
}
