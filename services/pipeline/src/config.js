/**
 * @file config.js
 * @description Single source of truth for all environment-variable-driven knobs.
 *
 * Every configurable threshold, limit, path, and toggle lives here.
 * No other file should call parseInt/parseFloat/Boolean on process.env directly -
 * import { config } from '../config.js' and reference the named property instead.
 *
 * Implemented with getters so values are read lazily at call time, not at module
 * load time. This means dotenv load order is never an issue, and values are always
 * current (useful in test environments that mutate process.env between cases).
 *
 * Defaults here must match the values documented in .env.
 * @module config
 */

const int  = (key, def) => parseInt(process.env[key]  ?? String(def));
const bool = (key, def) => (process.env[key] ?? (def ? 'true' : 'false')) === 'true';
const str  = (key, def) => process.env[key] ?? def;

export const config = {
  // -- Confidence thresholds --------------------------------------------------
  /** Overall extraction confidence at or above this value -> eligible for auto-submit */
  get CONFIDENCE_SUBMIT_THRESHOLD()     { return int('CONFIDENCE_SUBMIT_THRESHOLD', 85); },
  /** Overall extraction confidence below this value -> human review regardless of other checks */
  get CONFIDENCE_REVIEW_THRESHOLD()     { return int('CONFIDENCE_REVIEW_THRESHOLD', 50); },
  /** Confidence at or below this value -> document treated as unreadable */
  get CONFIDENCE_UNREADABLE_THRESHOLD() { return int('CONFIDENCE_UNREADABLE_THRESHOLD', 5); },

  // -- SKU resolution ---------------------------------------------------------
  /** AI SKU match at or above this score -> auto-resolved */
  get SKU_AUTO_THRESHOLD()      { return int('SKU_AUTO_THRESHOLD', 90); },
  /** AI SKU match below this score -> seek clarification; between this and auto -> review */
  get SKU_REVIEW_THRESHOLD()    { return int('SKU_REVIEW_THRESHOLD', 50); },
  /** When true: any AI-fuzzy SKU match routes to review regardless of confidence */
  get SKU_FUZZY_ALWAYS_REVIEW() { return bool('SKU_FUZZY_ALWAYS_REVIEW', false); },
  /** Maximum candidate SKUs returned by the AI resolver per line item */
  get SKU_MAX_CANDIDATES()      { return int('SKU_MAX_CANDIDATES', 3); },

  // -- Customer resolution ----------------------------------------------------
  /** AI customer match at or above this score -> auto-identified */
  get CUSTOMER_AUTO_THRESHOLD()      { return int('CUSTOMER_AUTO_THRESHOLD', 90); },
  /** AI customer match below this score -> seek clarification; between this and auto -> review */
  get CUSTOMER_REVIEW_THRESHOLD()    { return int('CUSTOMER_REVIEW_THRESHOLD', 60); },
  /** When true: any AI-fuzzy customer match routes to review regardless of confidence */
  get CUSTOMER_FUZZY_ALWAYS_REVIEW() { return bool('CUSTOMER_FUZZY_ALWAYS_REVIEW', false); },
  /** Maximum candidate customers returned by the AI matcher */
  get CUSTOMER_MAX_CANDIDATES()      { return int('CUSTOMER_MAX_CANDIDATES', 3); },

  // -- Business rules ---------------------------------------------------------
  /** Orders with more line items than this are flagged and routed to review */
  get MAX_LINE_ITEMS()           { return int('MAX_LINE_ITEMS', 100); },
  /**
   * How the pipeline handles line items where unit_price is explicitly zero.
   *   'reject'  - silent reject; treat as suspicious / possible prompt-injection attempt
   *   'review'  - pause for operator confirmation before any ERP action (default)
   *   'approve' - pass through; let the ERP or downstream pricing rules decide
   */
  get ZERO_PRICE_ACTION()        { return str('ZERO_PRICE_ACTION', 'review'); },
  /** PDFs with fewer characters than this are treated as likely scanned (low confidence) */
  get PDF_MIN_TEXT_LENGTH()      { return int('PDF_MIN_TEXT_LENGTH', 50); },
  /** When true: backorderable items auto-submit with backorder_eta in the ERP payload */
  get BACKORDER_AUTO_SUBMIT()    { return bool('BACKORDER_AUTO_SUBMIT', true); },
  /** Days back to check for a duplicate PO number + buyer account ID */
  get DUPLICATE_PO_WINDOW_DAYS() { return int('DUPLICATE_PO_WINDOW_DAYS', 30); },

  // -- Graph execution --------------------------------------------------------
  /** Maximum ms a graph.invoke() call may run before the channel abandons it */
  get GRAPH_TIMEOUT_MS() { return int('GRAPH_TIMEOUT_MS', 60000); },

  // -- API behaviour ----------------------------------------------------------
  /** When false: /api/v1/test/* endpoints are disabled (set false in production) */
  get ENABLE_TEST_ENDPOINTS()    { return str('ENABLE_TEST_ENDPOINTS', 'true') !== 'false'; },
  /** Max test/run calls per minute per IP - set high enough for Run All (52 tests) */
  get TEST_RUN_RATE_LIMIT()      { return int('TEST_RUN_RATE_LIMIT', 120); },
  /** Global API rate limit - max requests per minute per IP across all /api/v1 routes */
  get API_RATE_LIMIT()           { return int('API_RATE_LIMIT', 100); },

  // -- AI resilience ----------------------------------------------------------
  /** Max attempts for transient Claude API failures (extraction, SKU, customer) */
  get AI_RETRY_MAX_ATTEMPTS()    { return int('AI_RETRY_MAX_ATTEMPTS', 3); },
  /** Base delay between retry attempts in ms - doubles each attempt (1s -> 2s -> 4s) */
  get AI_RETRY_BASE_DELAY_MS()   { return int('AI_RETRY_BASE_DELAY_MS', 1000); },
  /** Maximum number of orders returned by the Live Feed */
  get LIVE_FEED_LIMIT()       { return int('LIVE_FEED_LIMIT', 100); },

  // -- EDI file paths (absolute, inside the container) -----------------------
  /** Inbox folder - EDI files dropped here trigger processing */
  get EDI_INBOX_PATH()    { return str('EDI_INBOX_PATH',    '/app/edi-inbox'); },
  /** Archive folder - processed and errored EDI files land here */
  get EDI_ERROR_PATH()    { return str('EDI_ERROR_PATH',    '/app/edi-error'); },
  /** Outbound folder - 864 and 855 replies are written here */
  get EDI_OUTBOUND_PATH() { return str('EDI_OUTBOUND_PATH', '/app/edi-outbound'); },

  // -- Polling intervals ------------------------------------------------------
  /** How often the EDI channel scans the inbox folder (ms) */
  get EDI_POLL_INTERVAL_MS()          { return int('EDI_POLL_INTERVAL_MS',          2000); },
  /** How often the email channel polls for new inbound messages (ms) */
  get INBOUND_MAIL_POLL_INTERVAL_MS() { return int('INBOUND_MAIL_POLL_INTERVAL_MS', 5000); },

  // -- External service URLs & connection settings ----------------------------
  /** Inbound email adapter: 'mailpit' (dev polling) or 'sendgrid' (production webhook) */
  get INBOUND_MAIL_PROVIDER()  { return str('INBOUND_MAIL_PROVIDER', 'mailpit'); },
  /** URL the pipeline polls for inbound emails - used only when INBOUND_MAIL_PROVIDER=mailpit */
  get INBOUND_MAIL_API_URL() { return str('INBOUND_MAIL_API_URL', 'http://mailpit:8025'); },
  /** SMTP server hostname - used for outbound clarification emails and test injection */
  get SMTP_HOST()            { return str('SMTP_HOST', 'mailpit'); },
  /** SMTP server port */
  get SMTP_PORT()            { return int('SMTP_PORT', 1025); },
  /** Port for the web-based email inbox viewer - Agent UI builds browser link from this */
  get EMAIL_VIEWER_PORT()    { return int('EMAIL_VIEWER_PORT', 8025); },
};
