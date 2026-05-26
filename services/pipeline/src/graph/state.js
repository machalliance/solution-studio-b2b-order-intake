/**
 * @file state.js
 * @description LangGraph state schema for the order processing graph.
 *              Typed state flows through every graph node and accumulates
 *              progressively: each node returns only the fields it changes.
 * @module graph/state
 */

/**
 * Resolution result for a single line item SKU.
 * @typedef {Object} SkuResolution
 * @property {number}      lineNumber     - 1-based line number matching MACH ODM lineItems[].lineNumber
 * @property {string}      buyerSku       - buyer's original SKU string (MACH ODM: buyerSku)
 * @property {string|null} resolvedSkuId  - matched internal sku_id from inventory, or null if unresolved
 * @property {'exact'|'auto'|'review'|'clarify'|'unresolved'} status
 *   - exact:    buyer SKU matched inventory sku_id directly
 *   - auto:     AI fuzzy match above auto-confidence threshold - accepted without human review
 *   - review:   AI fuzzy match between review and auto thresholds - needs operator confirmation
 *   - clarify:  AI confidence too low - buyer must be asked to confirm the correct SKU
 *   - unresolved: no match found and no candidates to offer
 * @property {Array<{skuId:string,confidence:number,reasoning:string}>} candidates - top AI matches
 * @property {string}      aiReasoning   - human-readable summary of AI matching decision
 * @property {boolean}     fuzzyMatched  - true if AI was used (not an exact string match)
 * @property {boolean}     backorder     - true if resolved SKU is on backorder
 * @property {Date|null}   backorderEta  - expected availability date, if known
 */

/**
 * Complete state object that flows through the order processing graph.
 * Nodes read from state and return partial updates; LangGraph merges them.
 * @typedef {Object} OrderState
 * @property {string}          orderId              - UUID assigned at intake, keyed to orders table
 * @property {string}          channel              - inbound channel: 'email' | 'edi'
 * @property {string}          contentType          - parsed format: 'plain_text'|'pdf'|'csv'|'xlsx'|'x12_850'
 * @property {string}          rawContent           - fully parsed text handed to the extraction AI
 * @property {Object|null}     channelMetadata      - channel-specific envelope (messageId, filename, etc.)
 * @property {string|null}     senderEmail          - normalised From address (email channel) or null (EDI)
 * @property {Object|null}     extractedOrder       - MACH ODM Order entity as returned by the extraction AI
 * @property {number}          confidenceScore      - extraction confidence 0-100 (AI self-assessed)
 * @property {Object[]}        lineItems            - MACH ODM lineItems[] from extractedOrder, promoted for convenience
 * @property {Object|null}     resolvedCustomer     - MACH ODM Customer entity matched from the customer catalogue
 * @property {Object[]}        customerCandidates   - top AI customer matches when confidence < auto threshold
 * @property {boolean}         customerFuzzyMatched - true if customer was matched by AI rather than exact lookup
 * @property {SkuResolution[]} skuResolutions       - one entry per line item after SKU resolution
 * @property {string[]}        validationErrors     - error code list (e.g. 'missing_poNumber', 'line_2_missing_quantity')
 * @property {string|null}     routingOutcome       - final routing decision: 'clarify'|'reject'|'review'|'submit'
 * @property {string}          routingReason        - human-readable explanation of the routing decision
 * @property {string}          aiReasoning          - AI extraction reasoning string from Claude
 * @property {Object[]}        auditEvents          - append-only list (unique reducer); flushed to DB at node boundaries
 * @property {Object|null}     erpResponse          - response from the ERP adapter after successful submission
 * @property {boolean}         isDuplicate          - true if the PO was already received within the duplicate window
 */

/**
 * LangGraph channel definitions for the OrderState.
 * All fields use 'replace' semantics (b ?? a) - last-write-wins per node - except
 * auditEvents which uses an append reducer so events from multiple nodes accumulate.
 *
 * Raw channel message fields (body/html/attachments/content/filename/subject) MUST
 * be declared here so they survive graph.invoke(rawMessage). LangGraph silently
 * drops any key not present in the channel schema before the first node runs.
 */
export const orderStateSchema = {
  // -- Raw channel message fields -----------------------------------------------
  // These arrive via graph.invoke() and are consumed only by the intake node.
  body:                 { value: (a, b) => b ?? a, default: () => null },
  html:                 { value: (a, b) => b ?? a, default: () => null },
  attachments:          { value: (a, b) => b ?? a, default: () => [] },
  subject:              { value: (a, b) => b ?? a, default: () => null },
  content:              { value: (a, b) => b ?? a, default: () => null },
  filename:             { value: (a, b) => b ?? a, default: () => null },

  // -- Pipeline state fields ----------------------------------------------------
  // Set by nodes as the order progresses through the graph.
  orderId:              { value: (a, b) => b ?? a, default: () => null },
  channel:              { value: (a, b) => b ?? a, default: () => null },
  contentType:          { value: (a, b) => b ?? a, default: () => null },
  rawContent:           { value: (a, b) => b ?? a, default: () => '' },
  channelMetadata:      { value: (a, b) => b ?? a, default: () => null },
  senderEmail:          { value: (a, b) => b ?? a, default: () => null },
  extractedOrder:       { value: (a, b) => b ?? a, default: () => null },
  confidenceScore:      { value: (a, b) => b ?? a, default: () => 0 },
  lineItems:            { value: (a, b) => b ?? a, default: () => [] },
  resolvedCustomer:     { value: (a, b) => b ?? a, default: () => null },
  customerCandidates:   { value: (a, b) => b ?? a, default: () => [] },
  customerFuzzyMatched: { value: (a, b) => b ?? a, default: () => false },
  skuResolutions:       { value: (a, b) => b ?? a, default: () => [] },
  validationErrors:     { value: (a, b) => b ?? a, default: () => [] },
  routingOutcome:       { value: (a, b) => b ?? a, default: () => null },
  routingReason:        { value: (a, b) => b ?? a, default: () => '' },
  aiReasoning:          { value: (a, b) => b ?? a, default: () => '' },
  // Append reducer - each node's audit events are added to the running list
  auditEvents:          { value: (a, b) => [...(a||[]), ...(b||[])], default: () => [] },
  erpResponse:          { value: (a, b) => b ?? a, default: () => null },
  isDuplicate:          { value: (a, b) => b ?? a, default: () => false },
  // -- Human-in-the-loop operator decision fields -------------------------------
  // Set via graph.updateState() when the operator actions a review item.
  // Null until the operator acts - the review node checks these on resume.
  operatorDecision:     { value: (a, b) => b ?? a, default: () => null },
  operatorNotes:        { value: (a, b) => b ?? a, default: () => '' },
  formalReject:         { value: (a, b) => b ?? a, default: () => false },
};
