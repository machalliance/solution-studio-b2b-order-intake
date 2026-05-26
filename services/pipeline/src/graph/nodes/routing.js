/**
 * @file routing.js
 * @description LangGraph routing node. Determines the routing outcome by evaluating
 *              document type, extraction confidence, validation errors, customer
 *              resolution status, and SKU resolution statuses. Writes the decision
 *              to both the orders table and the audit log.
 *
 * Decision cascade (evaluated top-to-bottom, first match wins):
 *   1.  BEC / phishing       -> reject  (silent, never reply - replying confirms live address)
 *   2.  Spam                 -> reject  (silent)
 *   3.  Known sender + unreadable -> clarify (request legible resubmission)
 *   4.  Inquiry + known sender -> clarify (auto-reply to correct channel)
 *   5.  Inquiry + unknown sender -> reject (silent)
 *   6.  Duplicate PO / no order -> reject
 *   7.  Repeat / amendment / cancellation + known -> review (never auto-submit)
 *   7b. Repeat / amendment / cancellation + unknown -> reject
 *   8.  Unknown sender + unreadable -> reject
 *   9.  Customer unresolved / SKU review / inventory issues / low confidence -> review
 *   10. Missing fields / ambiguous SKUs -> clarify
 *   11. Confidence >= SUBMIT_THRESHOLD -> submit
 *   12. Fallback -> review
 *
 * Thresholds are all configurable via env vars (Cloud-native / MACH-C):
 *   CONFIDENCE_SUBMIT_THRESHOLD     (default 85)
 *   CONFIDENCE_REVIEW_THRESHOLD     (default 50)
 *   CONFIDENCE_UNREADABLE_THRESHOLD (default 5)
 * @module graph/nodes/routing
 */
import { updateOrder } from '../../db/queries/orders.js';
import { config }      from '../../config.js';

/**
 * Factory for the LangGraph routing node.
 * @param {{ logging: import('../../../adapters/logging/index.js').LoggingAdapter }} adapters
 * @returns {Function} async LangGraph node
 */
export function makeRoutingNode({ logging }) {
  /**
   * @param {import('../state.js').OrderState} state
   * @returns {Promise<{ routingOutcome: string, routingReason: string }>}
   */
  return async function routingNode(state) {
    let outcome;
    let reason;

    const errors = state.validationErrors || [];

    // -- 1. BEC / phishing ---------------------------------------------------
    // Silent reject - never send a reply that would confirm a live inbox to the attacker
    if (state.extractedOrder?.documentType === 'bec') {
      outcome = 'reject';
      reason  = 'Business Email Compromise / phishing detected - silent reject, no reply sent';
    }

    // -- 2. Spam -------------------------------------------------------------
    else if (state.extractedOrder?.documentType === 'spam') {
      outcome = 'reject';
      reason  = 'Spam / unsolicited marketing - silent reject';
    }

    // -- 3. Known sender + unreadable document --------------------------------
    // Must fire BEFORE inquiry check: a degraded PDF attachment may have so little
    // content that the model classifies it as 'inquiry'. Unreadable takes priority
    // because the right reply is "we couldn't read your attachment" not "wrong inbox".
    else if (
      state.senderEmail &&
      !errors.includes('customer_unresolved') &&
      !errors.includes('duplicate_po') &&
      (errors.includes('no_order_extracted') || state.confidenceScore <= config.CONFIDENCE_UNREADABLE_THRESHOLD)
    ) {
      outcome = 'clarify';
      reason  = `Document unreadable or no order found - auto-reply sent to ${state.senderEmail} requesting legible resubmission`;
    }

    // -- 4. Inquiry from known sender -----------------------------------------
    // Auto-reply directing the sender to the correct contact channel
    else if (
      state.extractedOrder?.documentType === 'inquiry' &&
      state.senderEmail &&
      !errors.includes('customer_unresolved')
    ) {
      outcome = 'clarify';
      reason  = `Legitimate inquiry - auto-reply sent to ${state.senderEmail} directing to correct channel`;
    }

    // -- 5. Inquiry from unknown sender ---------------------------------------
    // Cannot safely reply; silent reject
    else if (state.extractedOrder?.documentType === 'inquiry') {
      outcome = 'reject';
      reason  = 'Inquiry from unrecognised sender - silent reject';
    }

    // -- 6. Duplicate PO / no extractable order -------------------------------
    else if (errors.includes('duplicate_po') || errors.includes('no_order_extracted')) {
      outcome = 'reject';
      reason  = errors.includes('duplicate_po')
        ? 'Duplicate PO detected'
        : 'Could not extract a valid order from this content';
    }

    // -- 7. Repeat order / amendment / cancellation ---------------------------
    // Never auto-submit non-new-order document types regardless of confidence:
    //   amendment    - operator must confirm changes before touching an existing PO
    //   repeat_order - operator should verify items and pricing from the referenced PO
    //   cancellation - operator must decide whether to action the cancellation in ERP
    else if (
      (state.extractedOrder?.documentType === 'repeat_order' ||
       state.extractedOrder?.documentType === 'amendment'    ||
       state.extractedOrder?.documentType === 'cancellation') &&
      !errors.includes('customer_unresolved')
    ) {
      outcome = 'review';
      reason  = {
        amendment:    'Order amendment detected - operator must review requested changes to existing PO before processing',
        repeat_order: 'Repeat order detected - operator should look up the referenced PO and confirm items before processing',
        cancellation: 'Order cancellation request - operator must decide whether to action in ERP',
      }[state.extractedOrder.documentType];
    }

    // Cancellation / amendment / repeat from unknown sender -> reject (cannot safely action)
    else if (
      state.extractedOrder?.documentType === 'cancellation' ||
      state.extractedOrder?.documentType === 'amendment'    ||
      state.extractedOrder?.documentType === 'repeat_order'
    ) {
      outcome = 'reject';
      reason  = `${state.extractedOrder.documentType.replace('_', ' ')} from unrecognised sender - rejected`;
    }

    // -- 8. Unknown sender + unreadable ---------------------------------------
    // Spam/junk the model failed to classify; no operator value in queuing for review
    else if (
      errors.includes('customer_unresolved') &&
      (state.confidenceScore <= config.CONFIDENCE_UNREADABLE_THRESHOLD || errors.includes('no_order_extracted'))
    ) {
      outcome = 'reject';
      reason  = 'Unrecognised sender with no extractable order content - rejected';
    }

    // -- 9. Human review required ---------------------------------------------
    // Covers: unknown customer, SKU needs operator confirmation, stock issues,
    // or extraction confidence too low to trust auto-submit.
    // SKU status 'clarify' with candidates goes to review (not clarify) because
    // the operator can select the right SKU directly rather than asking the buyer again.
    else if (
      errors.includes('customer_unresolved') ||
      state.skuResolutions?.some(r => r.status === 'review') ||
      state.skuResolutions?.some(r => r.status === 'clarify' && r.candidates?.length > 0) ||
      errors.some(e => e.includes('out_of_stock') || e.includes('backorder_needs_review')) ||
      state.confidenceScore < config.CONFIDENCE_REVIEW_THRESHOLD
    ) {
      outcome = 'review';
      reason  = buildReviewReason(errors, state.skuResolutions || [], state.confidenceScore);
    }

    // -- 10. Clarification required -------------------------------------------
    // Missing required fields or SKUs the buyer must confirm (no usable candidates)
    else if (
      errors.some(e => e.startsWith('missing_') || (e.startsWith('line_') && e.includes('missing'))) ||
      state.skuResolutions?.some(r => r.status === 'clarify') ||
      errors.includes('customer_unresolved')
    ) {
      outcome = 'clarify';
      reason  = buildClarifyReason(errors, state.skuResolutions || []);
    }

    // -- 11. Auto-submit ------------------------------------------------------
    else if (state.confidenceScore >= config.CONFIDENCE_SUBMIT_THRESHOLD) {
      outcome = 'submit';
      reason  = `Auto-submitted - confidence ${state.confidenceScore}%, all validation checks passed`;
    }

    // -- 12. Fallback: review -------------------------------------------------
    // Confidence is between review and submit thresholds with no specific failure flag -
    // safer to let an operator confirm than to auto-submit a borderline extraction
    else {
      outcome = 'review';
      reason  = `Confidence ${state.confidenceScore}% is below submission threshold (${config.CONFIDENCE_SUBMIT_THRESHOLD}%) - routed to review`;
    }

    await updateOrder(state.orderId, { routingOutcome: outcome, routingReason: reason, status: outcome });
    await logging.writeEvent({
      orderId:         state.orderId,
      eventType:       'routing',
      channel:         state.channel,
      outcome,
      confidenceScore: state.confidenceScore,
      metadata:        { reason, errors },
    });

    return { routingOutcome: outcome, routingReason: reason };
  };
}

/**
 * Build a human-readable review reason from validation errors and SKU statuses.
 * @param {string[]} errors
 * @param {import('../state.js').SkuResolution[]} skuResolutions
 * @param {number} confidenceScore
 * @returns {string}
 */
function buildReviewReason(errors, skuResolutions, confidenceScore) {
  const parts = [];
  if (errors.includes('customer_unresolved'))
    parts.push('customer identity unresolved - operator must identify account');
  const missing = errors.filter(e => e.startsWith('missing_'));
  if (missing.length)
    parts.push(`missing required fields: ${missing.map(e => e.replace('missing_', '').replace(/_/g, ' ')).join(', ')}`);
  const lineIssues = errors.filter(e => e.startsWith('line_') && e.includes('missing'));
  if (lineIssues.length)
    parts.push(lineIssues.map(e => {
      const m = e.match(/^line_(\d+)_(.+)$/);
      return m ? `line ${m[1]}: missing ${m[2].replace(/_/g, ' ')}` : e;
    }).join('; '));
  const skuReview = skuResolutions.filter(r => r.status === 'review');
  if (skuReview.length)
    parts.push(`unresolved SKUs on line${skuReview.length > 1 ? 's' : ''}: ${skuReview.map(r => r.lineNumber).join(', ')}`);
  const skuClarifyWithCandidates = skuResolutions.filter(r => r.status === 'clarify' && r.candidates?.length > 0);
  if (skuClarifyWithCandidates.length)
    parts.push(`ambiguous SKUs with candidates for operator selection on line${skuClarifyWithCandidates.length > 1 ? 's' : ''}: ${skuClarifyWithCandidates.map(r => r.lineNumber).join(', ')}`);
  const noStock = errors.filter(e => e.includes('out_of_stock'));
  if (noStock.length)
    parts.push(`out of stock: ${noStock.map(e => e.replace(/^line_\d+_/, '')).join(', ')}`);
  if (confidenceScore < config.CONFIDENCE_REVIEW_THRESHOLD)
    parts.push(`low extraction confidence (${confidenceScore}%)`);
  return `Routed to review - ${parts.join('; ')}`;
}

/**
 * Build a human-readable clarification reason from validation errors and SKU statuses.
 * @param {string[]} errors
 * @param {import('../state.js').SkuResolution[]} skuResolutions
 * @returns {string}
 */
function buildClarifyReason(errors, skuResolutions) {
  const parts = [];
  const missing = errors.filter(e => e.startsWith('missing_'));
  if (missing.length)
    parts.push(`missing required fields: ${missing.map(e => e.replace('missing_', '').replace(/_/g, ' ')).join(', ')}`);
  const lineIssues = errors.filter(e => e.startsWith('line_') && e.includes('missing'));
  if (lineIssues.length)
    parts.push(lineIssues.map(e => {
      const m = e.match(/^line_(\d+)_(.+)$/);
      return m ? `line ${m[1]}: missing ${m[2].replace(/_/g, ' ')}` : e;
    }).join('; '));
  const unresolvedSkus = skuResolutions.filter(r => r.status === 'clarify');
  if (unresolvedSkus.length)
    parts.push(`unmatched SKUs on line${unresolvedSkus.length > 1 ? 's' : ''}: ${unresolvedSkus.map(r => r.lineNumber).join(', ')}`);
  return `Clarification requested - ${parts.join('; ')}`;
}
