/**
 * @file customer.js
 * @description Customer identity resolution. Translates MACH ODM Order.buyer fields
 *              into the lookup criteria expected by the customer adapter.
 * @module validation/customer
 */

/**
 * Resolve the buyer on an extracted order to a known MACH ODM Customer entity.
 * Delegates the actual 5-step cascade to the customer adapter implementation.
 *
 * The senderEmail fallback is important for email-channel orders where the buyer
 * did not include their email address in the PO body but the From header is known.
 *
 * @param {Object|null} buyer             - MACH ODM Order.buyer (accountId, email, phone, companyName, address)
 * @param {Object} adapter                - customer lookup adapter (e.g. JsonCustomerLookupAdapter)
 * @param {string|null} [senderEmail]     - envelope From address from the channel (used as email fallback)
 * @returns {Promise<{
 *   customer: Object|null,               - matched MACH ODM Customer entity, or null
 *   candidates: Object[],                - top AI matches for operator review
 *   fuzzyMatched: boolean,               - true if AI was used
 *   aiReasoning: string                  - AI match summary for audit log
 * }>}
 */
export async function resolveCustomer(buyer, adapter, senderEmail) {
  return adapter.lookup({
    accountId:   buyer?.accountId,
    // buyer.email takes priority; senderEmail is the envelope From (domain-match fallback)
    email:       buyer?.email || senderEmail,
    phone:       buyer?.phone,
    companyName: buyer?.companyName,
    address:     buyer?.address,
  });
}
