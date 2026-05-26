/**
 * @file index.js
 * @description Builds and compiles the LangGraph order processing graph.
 *
 * Graph topology (linear pipeline -> conditional fan-out with human-in-the-loop):
 *
 *   intake -> extraction -> validation -> routing
 *                                        +- clarify -> END   (missing info, request resubmission)
 *                                        +- reject  -> END   (spam, BEC, duplicate PO, unreadable)
 *                                        +- submit  -> END   (ERP submission)
 *                                        +- review  -> [PAUSE - interruptBefore]
 *                                                       v  operator actions via POST /api/orders/:id/review
 *                                                    review (resumed with operatorDecision in state)
 *                                                       +- submit  -> END
 *                                                       +- reject  -> END
 *                                                       +- clarify -> END
 *
 * The PostgresSaver checkpointer persists the full graph state when the review
 * interrupt fires. On resume, graph.invoke(null, { configurable: { thread_id } })
 * restores state and continues from the review node - no manual ERP wiring needed.
 *
 * @module graph
 */
import { StateGraph, END }        from '@langchain/langgraph';
import { orderStateSchema }       from './state.js';
import { makeIntakeNode }         from './nodes/intake.js';
import { makeExtractionNode }     from './nodes/extraction.js';
import { makeValidationNode }     from './nodes/validation.js';
import { makeRoutingNode }        from './nodes/routing.js';
import { makeClarifyNode }        from './nodes/outcomes/clarify.js';
import { makeRejectNode }         from './nodes/outcomes/reject.js';
import { makeReviewNode }         from './nodes/outcomes/review.js';
import { makeSubmitNode }         from './nodes/outcomes/submit.js';

/**
 * Routing edge - reads the outcome set by the routing node.
 * @param {import('./state.js').OrderState} state
 * @returns {'clarify'|'reject'|'review'|'submit'}
 */
function routingEdge(state) {
  return state.routingOutcome;
}

/**
 * Post-review edge - reads the operatorDecision injected by the API before resume.
 * Returns END as a safety fallback if no decision is present (should not happen
 * in normal operation since the API always sets operatorDecision before invoking).
 * @param {import('./state.js').OrderState} state
 * @returns {'submit'|'reject'|'clarify'|typeof END}
 */
function reviewOutcomeEdge(state) {
  if (state.operatorDecision === 'submit')  return 'submit';
  if (state.operatorDecision === 'reject')  return 'reject';
  if (state.operatorDecision === 'clarify') return 'clarify';
  return END;
}

/**
 * Build and compile the LangGraph order processing graph.
 * @param {Object} adapters     - all adapter instances
 * @param {Object} checkpointer - LangGraph checkpointer (PostgresSaver) for persisting
 *                                interrupted graph state across restarts
 * @returns {import('@langchain/langgraph').CompiledStateGraph}
 */
export function buildOrderGraph(adapters, checkpointer) {
  const graph = new StateGraph({ channels: orderStateSchema });

  // Linear pipeline nodes
  graph.addNode('intake',     makeIntakeNode(adapters));
  graph.addNode('extraction', makeExtractionNode(adapters));
  graph.addNode('validation', makeValidationNode(adapters));
  graph.addNode('routing',    makeRoutingNode(adapters));

  // Outcome nodes
  graph.addNode('clarify',    makeClarifyNode(adapters));
  graph.addNode('reject',     makeRejectNode(adapters));
  graph.addNode('review',     makeReviewNode(adapters));
  graph.addNode('submit',     makeSubmitNode(adapters));

  // Linear pipeline edges
  graph.setEntryPoint('intake');
  graph.addEdge('intake',     'extraction');
  graph.addEdge('extraction', 'validation');
  graph.addEdge('validation', 'routing');

  // First-pass fan-out from routing
  graph.addConditionalEdges('routing', routingEdge, {
    clarify: 'clarify',
    reject:  'reject',
    review:  'review',
    submit:  'submit',
  });

  // Direct-path outcomes terminate immediately
  graph.addEdge('clarify', END);
  graph.addEdge('reject',  END);
  graph.addEdge('submit',  END);

  // After review node runs (on resume), route to the operator-chosen outcome
  graph.addConditionalEdges('review', reviewOutcomeEdge, {
    submit:  'submit',
    reject:  'reject',
    clarify: 'clarify',
  });

  // interruptBefore:['review'] + checkpointer = proper human-in-the-loop:
  //   first invoke pauses here and serialises state to Postgres
  //   graph.invoke(null, { configurable: { thread_id } }) resumes from this point
  return graph.compile({
    checkpointer,
    interruptBefore: ['review'],
  });
}
