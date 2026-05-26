/**
 * @file reject.js
 * @description Reject outcome node. Handles both auto-reject and operator-reject paths.
 *
 * Two rejection modes (determined by state.formalReject):
 *
 *   Silent reject (formalReject=false, default):
 *     No outbound message. Used for spam, BEC, unreadable-from-unknown, and any
 *     operator reject where no formal notification is appropriate. Replying to
 *     spam or BEC confirms a live inbox to the attacker - never send a reply.
 *
 *   Formal reject (formalReject=true, EDI channel only):
 *     Writes an X12 855 Purchase Order Acknowledgement (BAK02=RJ) to edi-outbound/.
 *     Used when the operator explicitly chooses to formally notify a legitimate
 *     trading partner whose order cannot be fulfilled.
 *
 * Auto-rejects from the routing node always use silent mode (formalReject defaults
 * to false and is never set by the routing node). Only operator-initiated rejects
 * via Human Review can trigger the formal 855 path.
 * @module graph/nodes/outcomes/reject
 */
import { parseISA, generate855 } from '../../../edi/generate.js';
import { logger }                from '../../../util/logger.js';

/**
 * Factory for the LangGraph reject outcome node.
 * @param {{ logging: import('../../../../adapters/logging/index.js').LoggingAdapter, ediOutbound: import('../../../../adapters/edi-outbound/index.js').EdiOutboundAdapter }} adapters
 * @returns {Function} async LangGraph node
 */
export function makeRejectNode({ logging, ediOutbound }) {
  /**
   * @param {import('../../state.js').OrderState} state
   * @returns {Promise<{}>}
   */
  return async function rejectNode(state) {
    // Formal 855 rejection is sent when:
    //   - Operator explicitly chose formal reject from Human Review, OR
    //   - X12 850 duplicate PO - a known trading partner who sent a duplicate 850
    //     deserves a formal 855 acknowledgement (X12 standard practice).
    //     Only X12 files have a parseable ISA envelope to address the reply to.
    //     CSV and XLSX duplicate POs use silent reject - no ISA = no valid 855.
    const isDuplicatePO = (state.validationErrors || []).includes('duplicate_po');
    const isX12 = state.contentType === 'x12_850';
    const isFormal = state.channel === 'edi' && (state.formalReject || (isDuplicatePO && isX12));

    if (isFormal) {
      // Formal EDI rejection: write X12 855 POA (BAK02=RJ) to outbound folder.
      // The trading partner receives a standard rejection acknowledgement.
      try {
        const isa        = parseISA(state.rawContent || '');
        const ediContent = generate855(
          state.extractedOrder?.poNumber || null,
          state.extractedOrder?.orderDate || null,
          isa
        );
        const filename = await ediOutbound.send('855', state.extractedOrder?.poNumber, ediContent);
        await logging.writeEvent({
          orderId:   state.orderId,
          eventType: 'reject_sent',
          channel:   state.channel,
          outcome:   'reject',
          metadata:  { sent: true, type: '855', filename, notes: state.operatorNotes || null, source: 'operator' },
        });
        logger.info({ orderId: state.orderId, filename }, 'Formal EDI reject: wrote 855');
      } catch (err) {
        logger.error({ err, orderId: state.orderId }, 'Failed to write 855 rejection');
        await logging.writeEvent({
          orderId:   state.orderId,
          eventType: 'error',
          metadata:  { stage: 'reject_855', error: err.message },
        });
      }
    } else {
      // Silent reject - log only, no outbound message
      await logging.writeEvent({
        orderId:   state.orderId,
        eventType: 'reject_sent',
        channel:   state.channel,
        outcome:   'reject',
        metadata:  { sent: false, silent: true, reason: state.routingReason },
      });
      logger.info({ orderId: state.orderId, reason: state.routingReason }, 'Order silently rejected');
    }

    return {};
  };
}
