/**
 * @file review.js
 * @description Human Review outcome node. Implements LangGraph human-in-the-loop via
 *              interruptBefore + PostgresSaver checkpointer.
 *
 * Execution lifecycle:
 *   1. Routing node sets routingOutcome='review' and writes it to the DB.
 *   2. Graph hits interruptBefore:['review'] - state is serialised to Postgres.
 *   3. Order appears in GET /api/orders/review/queue with status='review'.
 *   4. Operator actions via POST /api/orders/:id/review:
 *        - API calls graph.updateState to inject operatorDecision + formalReject + operatorNotes
 *        - API calls graph.invoke(null, { configurable: { thread_id } }) to resume
 *   5. This node runs: logs the operator action, updates routingOutcome.
 *   6. reviewOutcomeEdge routes to submit | reject | clarify.
 * @module graph/nodes/outcomes/review
 */
import { updateOrder } from '../../../db/queries/orders.js';
import { logger }      from '../../../util/logger.js';

/**
 * Factory for the LangGraph review outcome node.
 * @param {{ logging: import('../../../../adapters/logging/index.js').LoggingAdapter }} adapters
 * @returns {Function} async LangGraph node
 */
export function makeReviewNode({ logging }) {
  /**
   * @param {import('../../state.js').OrderState} state
   * @returns {Promise<Partial<import('../../state.js').OrderState>>}
   */
  return async function reviewNode(state) {
    if (!state.operatorDecision) {
      // First pass: graph interrupted here, operator has not yet acted.
      // Mark the order as in-review so it appears in the Human Review queue.
      await updateOrder(state.orderId, { status: 'review' });
      logger.info({ orderId: state.orderId }, 'Order queued for human review');
      return {};
    }

    // Resumed: operator has injected their decision via graph.updateState.
    // Log the action and update state so reviewOutcomeEdge routes correctly.
    try {
      await updateOrder(state.orderId, { status: `review_${state.operatorDecision}` });
      await logging.writeEvent({
        orderId:   state.orderId,
        eventType: 'review_actioned',
        channel:   state.channel,
        outcome:   state.operatorDecision,
        metadata:  {
          notes:        state.operatorNotes || null,
          formalReject: state.formalReject  || false,
          source:       'operator',
        },
      });
      logger.info({ orderId: state.orderId, decision: state.operatorDecision }, 'Operator review decision recorded');
    } catch (err) {
      logger.error({ err, orderId: state.orderId }, 'Review node error on resume');
    }

    // Return the updated routingOutcome so the reviewOutcomeEdge can read it
    return { routingOutcome: state.operatorDecision };
  };
}
