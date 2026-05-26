/**
 * @file clarify.js
 * @description Seek Clarification outcome node. Sends a tailored reply to the buyer
 *              via the NotificationAdapter (email) requesting missing information.
 *
 * Three distinct clarification modes (determined by flags passed to the adapter):
 *   - unreadable: document could not be parsed - asks buyer to resubmit in a readable format
 *   - inquiry:    non-order document from a known sender - redirects to the sales inbox
 *   - standard:  order with missing/ambiguous fields - lists exactly what is needed
 *
 * Confidence scores are intentionally excluded from outbound messages - sharing AI
 * internal scores would confuse buyers and may reveal system details unnecessarily.
 * @module graph/nodes/outcomes/clarify
 */
import { parseISA, generate864, build864MessageLines } from '../../../edi/generate.js';
import { config }          from '../../../config.js';
import { logger }          from '../../../util/logger.js';

/**
 * Factory for the LangGraph clarify outcome node.
 * @param {{ notification: import('../../../../adapters/notification/index.js').NotificationAdapter, logging: import('../../../../adapters/logging/index.js').LoggingAdapter, ediOutbound: import('../../../../adapters/edi-outbound/index.js').EdiOutboundAdapter }} adapters
 * @returns {Function} async LangGraph node
 */
export function makeClarifyNode({ notification, logging, ediOutbound }) {
  /**
   * @param {import('../../state.js').OrderState} state
   * @returns {Promise<{}>} empty - this is a terminal node, no state update needed
   */
  return async function clarifyNode(state) {
    try {
      // EDI channel: no sender email - auto-generate and transmit an 864 Text Message
      if (state.channel === 'edi') {
        await sendEdi864(state, logging, ediOutbound);
        return {};
      }

      if (!state.senderEmail) {
        logger.warn({ orderId: state.orderId }, 'Clarify: no sender email - cannot send reply');
        return {};
      }

      // Strip confidence scores from SKU suggestions - present skuId only.
      // Buyers should not see AI confidence internals.
      const skuCandidates = (state.skuResolutions || [])
        .filter(r => r.status === 'clarify' && r.candidates?.length)
        .map(r => ({
          lineNumber:  r.lineNumber,
          buyerSku:    r.buyerSku,
          suggestions: r.candidates.map(c => c.skuId),
        }));

      const unreadable = (state.confidenceScore ?? 100) <= config.CONFIDENCE_UNREADABLE_THRESHOLD;
      const inquiry    = state.extractedOrder?.documentType === 'inquiry';

      const result = await notification.sendClarification(
        state.senderEmail,
        state.extractedOrder,
        {
          validationErrors: state.validationErrors || [],
          skuCandidates,
          customerCandidates: [],
          operatorNotes: state.operatorNotes || null,
          unreadable,
          inquiry,
        },
        state.channel
      );

      await logging.writeEvent({
        orderId:   state.orderId,
        eventType: 'clarify_sent',
        channel:   state.channel,
        outcome:   'clarify',
        metadata:  {
          recipient: state.senderEmail,
          sent:      result.sent,
          subject:   result.subject,
          message:   result.body,
          unreadable,
          inquiry,
        },
      });
    } catch (err) {
      logger.error({ err, orderId: state.orderId }, 'Clarify node error');
      await logging.writeEvent({ orderId: state.orderId, eventType: 'error',
        metadata: { stage: 'clarify', error: err.message } });
    }
    // Terminal node - no state fields to update
    return {};
  };
}

/**
 * Auto-generate and write an X12 864 Text Message to edi-outbound/.
 * Called for EDI-channel orders where there is no email address to reply to.
 * @param {import('../../state.js').OrderState} state
 * @param {import('../../../../adapters/logging/index.js').LoggingAdapter} logging
 * @param {import('../../../../adapters/edi-outbound/index.js').EdiOutboundAdapter} ediOutbound
 */
async function sendEdi864(state, logging, ediOutbound) {
  try {
    const isa          = parseISA(state.rawContent || '');
    const poNumber     = state.extractedOrder?.poNumber || null;
    const messageLines = build864MessageLines(poNumber, state.validationErrors || [], state.operatorNotes || null);
    const ediContent   = generate864(poNumber, isa, messageLines);
    const filename     = await ediOutbound.send('864', poNumber, ediContent);

    await logging.writeEvent({
      orderId:   state.orderId,
      eventType: 'clarify_sent',
      channel:   state.channel,
      outcome:   'clarify',
      metadata:  { sent: true, type: '864', filename, auto: true },
    });
    logger.info({ orderId: state.orderId, filename }, 'EDI clarify: wrote 864');
  } catch (err) {
    logger.error({ err, orderId: state.orderId }, 'EDI 864 generation error');
    await logging.writeEvent({
      orderId:   state.orderId,
      eventType: 'error',
      metadata:  { stage: 'clarify_edi864', error: err.message },
    });
  }
}
