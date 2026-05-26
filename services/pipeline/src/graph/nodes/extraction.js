/**
 * @file extraction.js
 * @description LangGraph extraction node. Calls the AI extraction provider to parse
 *              free-form order content into a structured MACH ODM Order entity.
 *              Persists extracted fields to the orders table for downstream queries.
 * @module graph/nodes/extraction
 */
import { updateOrder } from '../../db/queries/orders.js';
import { logger }      from '../../util/logger.js';

/**
 * Factory for the LangGraph extraction node.
 * @param {{ extraction: import('../../../extraction/index.js').ExtractionAdapter, logging: import('../../../adapters/logging/index.js').LoggingAdapter }} adapters
 * @returns {Function} async LangGraph node
 */
export function makeExtractionNode({ extraction, logging }) {
  /**
   * @param {import('../state.js').OrderState} state
   * @returns {Promise<Partial<import('../state.js').OrderState>>}
   */
  return async function extractionNode(state) {
    try {
      // Pass channel context so the AI can apply channel-specific confidence rules
      // (e.g. missing senderEmail is expected and non-penalised for EDI/CSV).
      const result = await extraction.extract(state.rawContent, {
        channel:     state.channel,
        contentType: state.contentType,
        senderEmail: state.senderEmail,
      });

      // Persist MACH ODM Order fields to the DB so the review UI can display them
      // without needing to re-parse the JSON blob. These columns mirror the ODM spec.
      await updateOrder(state.orderId, {
        extractedOrder:  result.order,
        confidenceScore: result.confidenceScore,
        aiReasoning:     result.reasoning,
        poNumber:        result.order?.poNumber || null,
        buyerAccountId:  result.order?.buyer?.accountId || null,
        buyerCompany:    result.order?.buyer?.companyName || null,
        buyerEmail:      result.order?.buyer?.email || null,
        buyerPhone:      result.order?.buyer?.phone || null,
        buyerAddress:    result.order?.buyer?.address || null,
        shippingAddress: result.order?.shippingAddress || null,
      });

      await logging.writeEvent({
        orderId:         state.orderId,
        eventType:       'extraction',
        channel:         state.channel,
        confidenceScore: result.confidenceScore,
        aiReasoning:     result.reasoning,
        metadata:        { fieldsExtracted: Object.keys(result.order || {}) },
      });

      return {
        extractedOrder:  result.order,
        confidenceScore: result.confidenceScore,
        aiReasoning:     result.reasoning,
        // documentType is not part of MACH ODM Order but is used for routing decisions;
        // it lives on extractedOrder and is propagated to state for convenience
        documentType:    result.order?.documentType || 'new_order',
        // AI-extracted lineItems supersede any pre-parsed lines from the intake parser
        lineItems:       result.order?.lineItems || state.lineItems || [],
      };
    } catch (err) {
      logger.error({ err, orderId: state.orderId }, 'Extraction node error');
      await logging.writeEvent({
        orderId:   state.orderId,
        eventType: 'error',
        metadata:  { stage: 'extraction', error: err.message },
      });
      // Route to review rather than reject - a transient AI error should not silently discard a real order
      return { confidenceScore: 0, routingOutcome: 'review', routingReason: 'Extraction failed' };
    }
  };
}
