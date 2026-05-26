/**
 * @file submit.js
 * @description Submit to ERP outcome node. Assembles the final MACH ODM Order payload
 *              (with resolved SKUs and customer identity merged in), posts it to the ERP
 *              adapter, and updates backorder flags on the persisted line_items rows.
 * @module graph/nodes/outcomes/submit
 */
import { updateOrder }               from '../../../db/queries/orders.js';
import { logger }                    from '../../../util/logger.js';
import { updateLineItemsBackorder }  from '../../../db/queries/line_items.js';
import { recordErpSubmission }       from '../../../db/queries/erp.js';

/**
 * Factory for the LangGraph submit outcome node.
 * @param {{ erp: import('../../../../adapters/erp/index.js').ERPAdapter, logging: import('../../../../adapters/logging/index.js').LoggingAdapter }} adapters
 * @returns {Function} async LangGraph node
 */
export function makeSubmitNode({ erp, logging }) {
  /**
   * @param {import('../../state.js').OrderState} state
   * @returns {Promise<{ erpResponse: Object }|{}>}
   */
  return async function submitNode(state) {
    try {
      // Merge per-line resolution results with the original extracted line item details.
      // SKU resolution provides resolvedSkuId and backorder data; extraction provides
      // productDescription, quantity, unitOfMeasure, unitPrice.
      const resolvedLineItems = (state.skuResolutions || []).map(res => {
        const src = (state.lineItems || []).find(l => l.lineNumber === res.lineNumber) || {};
        return {
          // MACH ODM lineItems[] fields
          lineNumber:         res.lineNumber,
          buyerSku:           res.buyerSku,         // original buyer reference (MACH ODM: buyerSku)
          resolvedSkuId:      res.resolvedSkuId,    // internal SKU matched by the resolver
          productDescription: src.productDescription || null,
          quantity:           src.quantity || res.quantity || null,
          unitOfMeasure:      src.unitOfMeasure || null,
          unitPrice:          src.unitPrice || null,
          // Backorder fields are set by inventory check during validation
          backorder:          res.backorder || false,
          backorderEta:       res.backorderEta || null,
        };
      });

      // ERP payload: MACH ODM Order entity + resolved line items + matched customer record.
      // The ERP receives resolvedSkuId (internal) alongside buyerSku (buyer reference).
      const payload = {
        ...state.extractedOrder,  // poNumber, orderDate, buyer, shippingAddress, currency, etc.
        lineItems: resolvedLineItems,
        customer:  state.resolvedCustomer,  // MACH ODM Customer entity from lookup
      };

      const erpResponse = await erp.submitOrder(payload);

      // Persist the ERP submission record - the adapter returns only the ERP response,
      // recording it in our DB is the pipeline's responsibility.
      await recordErpSubmission(erpResponse.orderId, payload);

      // Update backorder flags - done here (not in validation) because the ERP may
      // amend backorder status on acceptance.
      await updateLineItemsBackorder(state.orderId, resolvedLineItems);

      await updateOrder(state.orderId, { status: 'submitted' });
      await logging.writeEvent({
        orderId:   state.orderId,
        eventType: 'erp_submission',
        channel:   state.channel,
        outcome:   'submit',
        metadata:  { erpOrderId: erpResponse.orderId, lineCount: resolvedLineItems.length },
      });

      return { erpResponse };
    } catch (err) {
      logger.error({ err, orderId: state.orderId }, 'Submit node error');
      await logging.writeEvent({ orderId: state.orderId, eventType: 'error',
        metadata: { stage: 'submit', error: err.message } });
      // Return empty - order status remains 'submit' in the DB; operator must investigate
      return {};
    }
  };
}
