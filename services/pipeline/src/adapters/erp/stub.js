/**
 * @file stub.js
 * @description ERP stub adapter - stores submitted orders in the erp_submissions table.
 *              Simulates an ERP system for local development and testing without
 *              requiring a real ERP integration (Microservices / MACH-M boundary).
 *
 * In production this would be replaced by a real ERP adapter (e.g. SAP, NetSuite)
 * that POSTs to the ERP API and returns the ERP-assigned order ID. The interface
 * contract (submitOrder -> { orderId, status, submittedAt }) must be preserved.
 * @module adapters/erp/stub
 */
export class StubERPAdapter {
  /**
   * Simulate submitting an order to the ERP.
   * Returns only the ERP response - persistence of the submission record is the
   * pipeline's concern (handled by recordErpSubmission in db/queries/erp.js).
   * A real adapter (NetSuite, SAP, etc.) would POST to the ERP API and return
   * whatever order ID and status the ERP assigns.
   *
   * @param {Object} order - MACH ODM Order entity (with resolvedSkuId on each lineItem
   *   and a `customer` field added by the submit node)
   * @returns {Promise<{ orderId: string, status: string, submittedAt: string }>}
   */
  async submitOrder(order) {
    return {
      orderId:     crypto.randomUUID(),  // real adapter returns ERP-assigned ID
      status:      'draft',              // stub always returns 'draft'; real ERP may differ
      submittedAt: new Date().toISOString(),
    };
  }
}
