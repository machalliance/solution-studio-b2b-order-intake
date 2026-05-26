/**
 * @file validation.js
 * @description LangGraph validation node. Orchestrates all validation sub-steps in order:
 *   1. Business rules (required MACH ODM fields present)
 *   2. Duplicate PO detection
 *   3. Customer identity resolution (5-step cascade: account ID -> email -> phone -> AI -> none)
 *   4. SKU resolution (exact match -> AI fuzzy match)
 *   5. Inventory availability
 *   6. Persist line_items rows to DB (so review/clarify/submit views all have data)
 * @module graph/nodes/validation
 */
import { validateBusinessRules } from '../../validation/business-rules.js';
import { resolveCustomer }       from '../../validation/customer.js';
import { resolveSkus }           from '../../validation/sku.js';
import { checkInventory }        from '../../validation/inventory.js';
import { isDuplicatePO }         from '../../db/queries/orders.js';
import { createLineItems }       from '../../db/queries/line_items.js';
import { logger }                from '../../util/logger.js';

/**
 * Factory for the LangGraph validation node.
 * @param {{ customer: import('../../../adapters/customer/index.js').CustomerLookupAdapter, sku: import('../../../sku/index.js').SkuResolverAdapter, logging: import('../../../adapters/logging/index.js').LoggingAdapter }} adapters
 * @returns {Function} async LangGraph node
 */
export function makeValidationNode({ customer, sku, logging }) {
  /**
   * @param {import('../state.js').OrderState} state
   * @returns {Promise<Partial<import('../state.js').OrderState>>}
   */
  return async function validationNode(state) {
    const errors = [];

    try {
      // -- Step 1: required MACH ODM fields -----------------------------------
      const brResult = validateBusinessRules(state.extractedOrder);
      errors.push(...brResult.errors);

      // -- Step 2: duplicate PO ------------------------------------------------
      // Only check when both poNumber and buyer.accountId are present - the query
      // requires both to avoid false positives across different buyer accounts.
      if (state.extractedOrder?.poNumber && state.extractedOrder?.buyer?.accountId) {
        const dup = await isDuplicatePO(
          state.extractedOrder.poNumber,
          state.extractedOrder.buyer.accountId
        );
        if (dup) {
          await logging.writeEvent({ orderId: state.orderId, eventType: 'validation',
            metadata: { duplicatePO: true } });
          // Short-circuit: no point running customer/SKU/inventory checks on a duplicate
          return { validationErrors: ['duplicate_po'], routingOutcome: 'reject',
            routingReason: 'Duplicate PO number detected within the review window' };
        }
      }

      // -- Step 3: customer identity resolution --------------------------------
      // Falls back to senderEmail for domain matching when buyer.email is absent.
      // The adapter runs the 5-step cascade internally.
      const customerResult = await resolveCustomer(state.extractedOrder?.buyer, customer, state.senderEmail);
      await logging.writeEvent({
        orderId:     state.orderId, eventType: 'customer_lookup',
        channel:     state.channel,
        aiReasoning: customerResult.aiReasoning || '',
        candidates:  customerResult.candidates || [],
        metadata:    { fuzzyMatched: customerResult.fuzzyMatched },
      });

      // -- Step 4: SKU resolution ----------------------------------------------
      const skuResults = await resolveSkus(state.lineItems || [], sku);
      for (const res of skuResults) {
        await logging.writeEvent({
          orderId:     state.orderId, eventType: 'sku_resolution',
          aiReasoning: res.aiReasoning || '',
          candidates:  res.candidates || [],
          metadata:    { lineNumber: res.lineNumber, status: res.status },
        });
      }

      // -- Step 5: inventory availability -------------------------------------
      const inventoryResult = await checkInventory(skuResults);

      // -- Step 6: persist line_items rows ------------------------------------
      // Inserted here so the review/clarify/submit views always have line data
      // available, regardless of which outcome branch runs. The submit node
      // later UPDATEs backorder_flag and backorder_eta on these same rows.
      await createLineItems(state.orderId, skuResults, state.lineItems || []);

      await logging.writeEvent({
        orderId:   state.orderId,
        eventType: 'validation',
        channel:   state.channel,
        metadata:  {
          businessRuleErrors: brResult.errors,
          customerFound:      !!customerResult.customer,
          skuStatuses:        skuResults.map(r => ({ line: r.lineNumber, status: r.status })),
          inventoryIssues:    inventoryResult.issues,
        },
      });

      return {
        resolvedCustomer:     customerResult.customer,
        customerCandidates:   customerResult.candidates,
        customerFuzzyMatched: customerResult.fuzzyMatched,
        skuResolutions:       skuResults,
        // Merge all error codes into a single list for the routing node
        validationErrors:     [
          ...errors,
          ...(customerResult.customer ? [] : ['customer_unresolved']),
          ...inventoryResult.issues,
        ],
      };
    } catch (err) {
      logger.error({ err, orderId: state.orderId }, 'Validation node error');
      await logging.writeEvent({ orderId: state.orderId, eventType: 'error',
        metadata: { stage: 'validation', error: err.message } });
      return { validationErrors: ['validation_error'] };
    }
  };
}
