/**
 * @file intake.js
 * @description LangGraph intake node. Normalises inbound channel messages into a
 *              consistent OrderState regardless of channel (email vs EDI) or content
 *              format (plain text, PDF, CSV, XLSX, X12 850).
 * @module graph/nodes/intake
 */
import { createContentParser, detectEmailContentType } from '../../parsers/index.js';
import { createOrder, updateOrder } from '../../db/queries/orders.js';
import { logger }                   from '../../util/logger.js';

/**
 * Factory for the LangGraph intake node.
 * @param {{ logging: import('../../../adapters/logging/index.js').LoggingAdapter }} adapters
 * @returns {Function} async LangGraph node - accepts raw channel message, returns partial OrderState
 */
export function makeIntakeNode({ logging }) {
  /**
   * @param {Object} message - raw inbound message from a channel adapter
   * @param {string} message.channel          - 'email' | 'edi'
   * @param {string} [message.contentType]    - pre-set by EDI channel; auto-detected for email
   * @param {string} [message.body]           - email plain-text body
   * @param {Buffer} [message.content]        - EDI/binary file content
   * @param {string} [message.senderEmail]    - From address (email only)
   * @param {Object} [message.channelMetadata] - channel envelope data (messageId, filename, etc.)
   * @param {Object[]} [message.attachments]  - email attachments
   * @returns {Promise<Partial<import('../state.js').OrderState>>}
   */
  return async function intakeNode(message) {
    // EDI channel sets contentType directly; email channel requires heuristic detection
    const contentType = message.contentType || detectEmailContentType(message);

    // Persist the order record BEFORE parsing so every received document has a
    // database trace - even if the parser crashes. rawContent is the unprocessed
    // channel body at this stage; it is overwritten below once parsing succeeds.
    // Use the pre-generated orderId (= LangGraph thread_id) if the channel provided one.
    // This ensures the checkpointer thread_id and the DB order_id are the same UUID,
    // so graph.invoke(null, { thread_id: orderId }) can resume the correct graph state.
    const orderRow = await createOrder({
      orderId:         message.orderId || null,
      channel:         message.channel,
      contentType,
      rawContent:      message.body || message.text || null,
      channelMetadata: message.channelMetadata,
      senderEmail:     message.senderEmail || null,
      poNumber:        null,
    });

    await logging.writeEvent({
      orderId:   orderRow.order_id,
      eventType: 'intake',
      channel:   message.channel,
      metadata:  { contentType, filename: message.filename || null },
    });

    try {
      const parser = createContentParser(contentType);
      const parsed = await parser.parse(message);

      // Replace the raw channel body with fully-extracted text (e.g. PDFs are decoded here).
      // Downstream nodes (extraction, validation) receive only the clean text.
      await updateOrder(orderRow.order_id, { rawContent: parsed.text });

      return {
        orderId:         orderRow.order_id,
        channel:         message.channel,
        contentType,
        rawContent:      parsed.text,
        channelMetadata: message.channelMetadata || null,
        senderEmail:     message.senderEmail || null,
        // Structured CSV/XLSX parsers may return pre-parsed line items; plain text returns []
        lineItems:       parsed.structured?.lines || [],
      };
    } catch (err) {
      logger.error({ err, orderId: orderRow.order_id }, 'Intake node error');
      await logging.writeEvent({
        orderId:   orderRow.order_id,
        eventType: 'error',
        channel:   message.channel,
        metadata:  { stage: 'intake', error: err.message },
      });
      // Short-circuit the graph: setting routingOutcome here causes the routing
      // edge to bypass extraction and validation entirely
      return {
        orderId:        orderRow.order_id,
        routingOutcome: 'reject',
        routingReason:  `Intake error: ${err.message}`,
      };
    }
  };
}
