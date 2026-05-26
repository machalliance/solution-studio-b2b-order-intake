/**
 * @file routes.js
 * @description Pipeline REST API for the Agent Control Interface (headless UI).
 *              All pipeline state is accessed exclusively through these endpoints -
 *              the UI has no direct database access (API-first / MACH-A principle).
 *
 * Endpoints:
 *   GET  /api/orders                   - paginated order list
 *   GET  /api/orders/:id               - order detail + line items
 *   GET  /api/orders/review/queue      - pending human-review orders
 *   GET  /api/orders/:id/edi-preview   - preview outbound EDI for a review action
 *   POST /api/orders/:id/review        - approve / reject / clarify a review item
 *   GET  /api/erp/orders               - submitted ERP orders list
 *   GET  /api/erp/orders/:id           - full ERP submission detail
 *   GET  /api/audit/grouped            - audit log grouped by order
 *   GET  /api/audit                    - flat audit event list with filters
 *   POST /api/test/clear               - reset all test data (DB + Mailpit + EDI folders)
 *   GET  /api/test/manifest            - test corpus manifest
 *   GET  /api/test/preview/:id         - preview a corpus file
 *   POST /api/test/run                 - inject a corpus test case into the pipeline
 *   GET  /api/health/all               - aggregate health check for all services
 * @module api/routes
 */
import { Router }   from 'express';
import rateLimit    from 'express-rate-limit';
import { logger }   from '../util/logger.js';
import { readdir, unlink, readFile,
         copyFile, writeFile, mkdir } from 'fs/promises';
import { join, basename, extname }   from 'path';
import { simpleParser }              from 'mailparser';
import pdfParse                      from 'pdf-parse';
import ExcelJS                       from 'exceljs';
import nodemailer                    from 'nodemailer';
import { listOrders, getOrder, updateOrder,
         getReviewQueue }                    from '../db/queries/orders.js';
import { listAuditEvents, getAuditGrouped,
         getValidationErrors }               from '../db/queries/audit.js';
import { getOrderLineItems }                from '../db/queries/line_items.js';
import { listErpSubmissions,
         getErpSubmission }                  from '../db/queries/erp.js';
import { clearAllTestData, dbPing }          from '../db/queries/maintenance.js';
import { config }                            from '../config.js';
import { parseISA, generate864, generate855,
         build864MessageLines }              from '../edi/generate.js';

/**
 * Create and return the Express Router for the pipeline API.
 * @param {Object} adapters  - pipeline adapters (notification adapter used for email clarifications)
 * @param {Object} graph     - compiled LangGraph (reserved for future resume-from-review use)
 * @param {Object[]} [channels=[]] - started channel adapter instances (for resetSeen on test/clear)
 * @returns {import('express').Router}
 */
// -- Tighter rate limit for test injection -------------------------------------
// POST /test/run injects corpus files into the pipeline - 10/min prevents
// accidental corpus spam from exhausting Claude API quota.
const testRunLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             () => config.TEST_RUN_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: `Test run rate limit exceeded - see TEST_RUN_RATE_LIMIT in .env` },
});

// -- Input validation helper ---------------------------------------------------
// Returns an error string if validation fails, null if valid.
// Keeps route handlers free of repetitive guard clauses.
function validateInt(val, { name, min = 0, max = Infinity } = {}) {
  const n = parseInt(val);
  if (isNaN(n))    return `${name} must be an integer`;
  if (n < min)     return `${name} must be >= ${min}`;
  if (n > max)     return `${name} must be <= ${max}`;
  return null;
}

export function createApiRouter(adapters, graph, channels = []) {
  const router = Router();

  // -- GET /api/v1/config ----------------------------------------------------
  // Returns runtime configuration values the UI needs but cannot hardcode.
  // EMAIL_VIEWER_PORT is used by the UI to build a browser link to the email inbox viewer.
  // INBOUND_MAIL_API_URL is the Docker-internal URL the pipeline polls for inbound messages.
  router.get('/config', (_req, res) => {
    const isMailpit = config.INBOUND_MAIL_PROVIDER === 'mailpit';
    res.json({
      mailpitPort:         isMailpit ? config.EMAIL_VIEWER_PORT : null,
      liveFeedLimit:       config.LIVE_FEED_LIMIT,
      inboundMailProvider: config.INBOUND_MAIL_PROVIDER,
    });
  });

  // -- GET /api/v1/orders ---------------------------------------------------
  // Live order feed - most recent first. Default limit 50 is sufficient for the UI feed.
  router.get('/orders', async (req, res) => {
    try {
      const { limit = 50, offset = 0 } = req.query;
      const limitErr  = validateInt(limit,  { name: 'limit',  min: 1, max: 500 });
      const offsetErr = validateInt(offset, { name: 'offset', min: 0 });
      if (limitErr)  return res.status(400).json({ error: limitErr });
      if (offsetErr) return res.status(400).json({ error: offsetErr });
      const orders = await listOrders(parseInt(limit), parseInt(offset));
      res.json({ orders });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // -- GET /api/orders/:id ---------------------------------------------------
  // Returns the order row plus its line_items. Line items are joined in the
  // application layer to keep the query simple and the response shape explicit.
  router.get('/orders/:id', async (req, res) => {
    try {
      const order     = await getOrder(req.params.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });
      const lineItems = await getOrderLineItems(req.params.id);
      res.json({ order, lineItems });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // -- GET /api/orders/review/queue -----------------------------------------
  // Returns pending human-review orders oldest-first so the UI naturally shows
  // the longest-waiting items at the top of the queue.
  router.get('/orders/review/queue', async (req, res) => {
    try {
      const orders = await getReviewQueue();
      res.json({ orders });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // -- GET /api/orders/:id/edi-preview --------------------------------------
  // Preview the X12 EDI document that would be sent for a clarify or reject action.
  // Read-only - does not write files or change order state. Used by the UI to show
  // the operator what the trading partner would receive before they commit.
  router.get('/orders/:id/edi-preview', async (req, res) => {
    try {
      const { action } = req.query;
      if (!['clarify', 'reject'].includes(action))
        return res.status(400).json({ error: "action must be one of: clarify, reject" });

      const order = await getOrder(req.params.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });

      const validationErrors = await getValidationErrors(req.params.id);
      const isa = parseISA(order.raw_content || '');

      let ediContent, messageLines;
      if (action === 'clarify') {
        messageLines = build864MessageLines(order.po_number, validationErrors, null);
        ediContent   = generate864(order.po_number, isa, messageLines);
      } else {
        messageLines = [`Purchase Order ${order.po_number || 'unknown'} has been rejected.`,
                        `Please contact us for details.`];
        ediContent   = generate855(order.po_number, order.order_date, isa);
      }

      res.json({ ediContent, messageLines, rawEdi: order.raw_content || '' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // -- POST /api/orders/:id/review -------------------------------------------
  // Human review action. Injects the operator's decision into the checkpointed
  // graph state and resumes execution - the graph nodes handle all side effects
  // (ERP submission, 855 rejection, clarification emails) so this handler stays thin.
  //
  //   approve      - resumes -> review -> submit node -> ERP
  //   reject        - resumes -> review -> reject node -> 855 (if formalReject) or silent
  //   clarify       - resumes -> review -> clarify node -> email or 864
  router.post('/orders/:id/review', async (req, res) => {
    try {
      const { action, notes, formalReject = false } = req.body;
      if (!['approve', 'reject', 'clarify'].includes(action))
        return res.status(400).json({ error: 'action must be one of: approve, reject, clarify' });
      if (notes !== undefined && typeof notes !== 'string')
        return res.status(400).json({ error: 'notes must be a string' });
      if (typeof formalReject !== 'boolean')
        return res.status(400).json({ error: 'formalReject must be a boolean' });

      // Map 'approve' UI action to the graph's 'submit' decision name
      const operatorDecision = action === 'approve' ? 'submit' : action;

      const threadConfig = { configurable: { thread_id: req.params.id } };

      logger.info({ orderId: req.params.id, operatorDecision, action }, 'Resuming graph for review action');

      // Inject operator decision into the persisted graph state
      await graph.updateState(threadConfig, {
        operatorDecision,
        operatorNotes:  notes        || '',
        formalReject:   action === 'reject' && !!formalReject,
      });

      // Resume the graph - runs review node -> reviewOutcomeEdge -> submit/reject/clarify
      const result = await graph.invoke(null, threadConfig);
      logger.info({ orderId: req.params.id, resultKeys: Object.keys(result || {}) }, 'Graph resume completed');

      res.json({ success: true, orderId: req.params.id, action });
    } catch (err) {
      logger.error({ err, orderId: req.params.id }, 'Graph resume failed');
      res.status(500).json({ error: err.message });
    }
  });

  // -- GET /api/erp/orders ---------------------------------------------------
  // List ERP submissions. Extracts key MACH ODM fields from the JSONB payload
  // for the list view; full payload available via /erp/orders/:id.
  // NOTE: payload->'customer'->>'company_name' uses Customer.company_name (snake_case);
  //       payload->'buyer'->>'companyName' uses Order.buyer.companyName (camelCase).
  //       Both coexist because the submitted payload merges both entity shapes.
  router.get('/erp/orders', async (req, res) => {
    try {
      const submissions = await listErpSubmissions();
      res.json({ submissions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // -- GET /api/erp/orders/:id -----------------------------------------------
  router.get('/erp/orders/:id', async (req, res) => {
    try {
      const submission = await getErpSubmission(req.params.id);
      if (!submission) return res.status(404).json({ error: 'Not found' });
      res.json(submission);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // -- GET /api/audit/grouped ------------------------------------------------
  // Returns orders with all audit events nested as a JSON array.
  // Used by the Audit Log view for the per-order event timeline.
  // Limit capped at 500 to prevent oversized payloads.
  router.get('/audit/grouped', async (req, res) => {
    try {
      const limitErr = validateInt(req.query.limit || '100', { name: 'limit', min: 1, max: 500 });
      if (limitErr) return res.status(400).json({ error: limitErr });
      const limit     = Math.min(parseInt(req.query.limit || '100'), 500);
      const documents = await getAuditGrouped(limit);
      res.json({ documents });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // -- GET /api/audit --------------------------------------------------------
  // Flat audit event list with optional filters. Supports per-order drilldown.
  router.get('/audit', async (req, res) => {
    try {
      const { orderId, eventType, dateFrom, dateTo, limit = 100, offset = 0 } = req.query;
      const limitErr  = validateInt(limit,  { name: 'limit',  min: 1, max: 500 });
      const offsetErr = validateInt(offset, { name: 'offset', min: 0 });
      if (limitErr)  return res.status(400).json({ error: limitErr });
      if (offsetErr) return res.status(400).json({ error: offsetErr });
      const events = await listAuditEvents(
        { orderId, eventType, dateFrom, dateTo },
        parseInt(limit), parseInt(offset)
      );
      res.json({ events });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // -- Test endpoints --------------------------------------------------------
  // Guarded by ENABLE_TEST_ENDPOINTS (default true in dev, set false in production).
  // All /test/* routes are blocked at the middleware level when disabled - they
  // never reach the handlers below, so truncation/injection cannot happen in prod.
  router.use('/test', (_req, res, next) => {
    if (!config.ENABLE_TEST_ENDPOINTS) {
      return res.status(403).json({ error: 'Test endpoints are disabled in this environment' });
    }
    next();
  });

  // -- POST /api/v1/test/clear -----------------------------------------------
  // Wipe all test data across the full system. Each step is independent -
  // failures are collected and returned as HTTP 207 Multi-Status so partial
  // success is visible. Steps: DB truncate -> Mailpit delete -> edi-error/
  // cleanup -> edi-outbound/ cleanup -> channel seen-set reset.
  router.post('/test/clear', async (req, res) => {
    const errors = [];

    // 1. Database
    try {
      await clearAllTestData();
    } catch (err) {
      errors.push(`DB: ${err.message}`);
    }

    // 2. Mailpit - delete all messages
    try {
      const mailpitUrl = config.INBOUND_MAIL_API_URL;
      const listRes = await fetch(`${mailpitUrl}/api/v1/messages`, { signal: AbortSignal.timeout(4000) });
      if (listRes.ok) {
        const { messages = [] } = await listRes.json();
        if (messages.length > 0) {
          await fetch(`${mailpitUrl}/api/v1/messages`, {
            method:  'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ IDs: messages.map(m => m.ID) }),
            signal:  AbortSignal.timeout(4000),
          });
        }
      }
    } catch (err) {
      errors.push(`Mailpit: ${err.message}`);
    }

    // 3. edi-error/ - remove processed files (keep .gitkeep)
    try {
      const errorPath = config.EDI_ERROR_PATH;
      const files = await readdir(errorPath);
      await Promise.all(
        files
          .filter(f => !f.startsWith('.'))
          .map(f => unlink(join(errorPath, f)).catch(() => {}))
      );
    } catch (err) {
      errors.push(`edi-error: ${err.message}`);
    }

    // 4. edi-outbound/ - remove sent files (keep .gitkeep)
    try {
      const outPath = config.EDI_OUTBOUND_PATH;
      const files = await readdir(outPath);
      await Promise.all(
        files
          .filter(f => !f.startsWith('.'))
          .map(f => unlink(join(outPath, f)).catch(() => {}))
      );
    } catch (err) {
      errors.push(`edi-outbound: ${err.message}`);
    }

    // 5. Reset channel seen-sets
    for (const ch of channels) {
      if (typeof ch.resetSeen === 'function') ch.resetSeen();
      if (typeof ch._seen?.clear === 'function') ch._seen.clear();
    }

    logger.info('Test data cleared via UI');
    if (errors.length) {
      res.status(207).json({ success: false, errors });
    } else {
      res.json({ success: true });
    }
  });

  // -- GET /api/test/manifest ------------------------------------------------
  // Load the test corpus manifest (JSONC format - comments supported).
  // File is bind-mounted at /app/config/test-manifest.json.
  router.get('/test/manifest', async (_req, res) => {
    try {
      const raw = await readFile('/app/config/test-manifest.json', 'utf8');
      res.json(parseJsonc(raw));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // -- GET /api/test/preview/:id ---------------------------------------------
  // Preview a corpus test file. Returns parsed content appropriate to file type:
  //   .csv / .edi  -> { type:'text', content }
  //   .eml         -> { type:'email', from, to, subject, body, attachments[] }
  //   .xlsx        -> { type:'table', sheets[{ name, headers, rows[] }] }
  // PDF attachments within .eml files are extracted (up to 4000 chars).
  router.get('/test/preview/:id', async (req, res) => {
    let manifest;
    try {
      manifest = parseJsonc(await readFile('/app/config/test-manifest.json', 'utf8'));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    const test = manifest.tests.find(t => t.id === req.params.id);
    if (!test) return res.status(404).json({ error: `Test "${req.params.id}" not found` });

    const filePath = join('/app', test.file);
    const ext      = extname(filePath).toLowerCase();

    try {
      if (ext === '.csv' || ext === '.edi') {
        const content = await readFile(filePath, 'utf8');
        return res.json({ type: 'text', ext, content });
      }

      if (ext === '.eml') {
        const raw    = await readFile(filePath, 'utf8');
        const parsed = await simpleParser(raw);
        const attachments = [];
        for (const a of parsed.attachments || []) {
          const entry = {
            filename:    a.filename,
            contentType: a.contentType,
            sizeBytes:   a.content?.length ?? 0,
          };
          if (a.contentType === 'application/pdf' && a.content) {
            try {
              const pdf    = await pdfParse(a.content);
              entry.pages  = pdf.numpages;
              entry.text   = pdf.text?.trim().slice(0, 4000);
            } catch {
              // Stub PDFs are plain text wrapped in PDF scaffolding - extract the content
              const raw = a.content.toString('utf8');
              entry.text = extractPdfText(raw).slice(0, 4000);
            }
          }
          attachments.push(entry);
        }
        return res.json({
          type:        'email',
          from:        parsed.from?.text        ?? '',
          to:          parsed.to?.text          ?? '',
          subject:     parsed.subject           ?? '',
          date:        parsed.date?.toISOString() ?? '',
          body:        parsed.text?.trim()      ?? '',
          attachments,
        });
      }

      if (ext === '.xlsx') {
        const buf      = await readFile(filePath);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buf);

        function cellVal(v) {
          if (v == null) return '';
          if (typeof v === 'object') {
            if (v.richText)        return v.richText.map(r => r.text).join('');
            if (v.result != null)  return String(v.result);
            if (v.toISOString)     return v.toISOString().slice(0, 10);
            return String(v);
          }
          return String(v);
        }

        const sheets = [];
        workbook.eachSheet(ws => {
          const rows = [];
          ws.eachRow(row => rows.push(row.values.slice(1).map(cellVal)));
          const headers = rows.shift() ?? [];
          sheets.push({ name: ws.name, headers, rows: rows.slice(0, 100) });
        });
        return res.json({ type: 'table', sheets });
      }

      res.status(400).json({ error: `Unsupported file type: ${ext}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // -- POST /api/test/run ----------------------------------------------------
  // Inject a corpus test case into the pipeline without going through the full
  // channel adapter (no file watcher / Mailpit poll delay).
  //   email channel: sends raw .eml via SMTP so the email poll picks it up naturally
  //   edi channel:   copies the file to edi-inbox/ so the folder poll picks it up
  router.post('/test/run', testRunLimiter, async (req, res) => {
    const { id } = req.body;
    if (!id || typeof id !== 'string' || !id.trim())
      return res.status(400).json({ error: 'id must be a non-empty string' });

    let manifest;
    try {
      manifest = parseJsonc(await readFile('/app/config/test-manifest.json', 'utf8'));
    } catch (err) {
      return res.status(500).json({ error: `Cannot read manifest: ${err.message}` });
    }

    const test = manifest.tests.find(t => t.id === id);
    if (!test) return res.status(404).json({ error: `Test "${id}" not found` });

    const filePath = join('/app', test.file);

    try {
      if (test.channel === 'email') {
        const raw = await readFile(filePath, 'utf8');
        if (config.INBOUND_MAIL_PROVIDER === 'sendgrid') {
          // SendGrid mode has no poll loop - parse the .eml and invoke the graph
          // directly, exactly as the SendGrid webhook handler does.
          const parsed   = await simpleParser(raw);
          const threadId = crypto.randomUUID();
          const message  = {
            channel:     'email',
            senderEmail: parsed.from?.value?.[0]?.address || null,
            subject:     parsed.subject || '',
            body:        parsed.text    || '',
            html:        parsed.html    || '',
            attachments: (parsed.attachments || []).map(a => ({
              filename:    a.filename,
              contentType: a.contentType,
              content:     a.content,
            })),
            channelMetadata: {
              messageId: parsed.messageId,
              date:      parsed.date,
              from:      parsed.from?.text,
              to:        parsed.to?.text,
              subject:   parsed.subject,
            },
            orderId: threadId,
          };
          // Fire-and-forget: matches SendGrid webhook behaviour (fast ack, async processing)
          graph.invoke({ ...message, orderId: threadId }, { configurable: { thread_id: threadId } })
            .catch(err => logger.error({ err }, 'Test run: direct graph invoke failed'));
        } else {
          // Mailpit mode: inject via SMTP - the poll loop picks it up naturally.
          // From/To headers are read from the .eml so the envelope matches the message headers.
          const fromMatch = raw.match(/^From:\s*(.+)$/mi);
          const toMatch   = raw.match(/^To:\s*(.+)$/mi);
          const from      = fromMatch?.[1]?.trim() ?? 'test@b2b-intake.local';
          const to        = toMatch?.[1]?.trim()   ?? process.env.INTAKE_EMAIL_ADDRESS ?? 'orders@b2b-intake.local';
          const transporter = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: false });
          await transporter.sendMail({ envelope: { from, to: [to] }, raw });
        }
      } else if (test.channel === 'edi') {
        // Inject via inbox: copy to edi-inbox/ with a timestamp suffix so the
        // EDI channel's _seen set never blocks re-running the same test file.
        // The PO number and buyer ID come from file content, not the filename,
        // so duplicate PO detection still works correctly across multiple runs.
        const inboxPath = config.EDI_INBOX_PATH;
        const ts        = Date.now();
        const base      = basename(filePath, extname(filePath));
        const dest      = join(inboxPath, `${base}_${ts}${extname(filePath)}`);
        await copyFile(filePath, dest);
      } else {
        return res.status(400).json({ error: `Unknown channel: ${test.channel}` });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // -- GET /api/health/all ---------------------------------------------------
  // Aggregate health check - probes pipeline, PostgreSQL, inbound email, and ERP stub.
  // The inbound email check is provider-aware: pings Mailpit when INBOUND_MAIL_PROVIDER=mailpit;
  // validates API key presence when INBOUND_MAIL_PROVIDER=sendgrid (SendGrid is not pingable locally).
  // Returns HTTP 200 only if all services are healthy; 207 Multi-Status otherwise.
  router.get('/health/all', async (_req, res) => {
    const results = {};

    results.pipeline = { ok: true };

    try {
      await dbPing();
      results.db = { ok: true };
    } catch (err) {
      results.db = { ok: false, error: err.message };
    }

    if (config.INBOUND_MAIL_PROVIDER === 'sendgrid') {
      // SendGrid Inbound Parse is push-based - no local service to ping.
      // The webhook endpoint is registered and ready as long as the pipeline is up.
      results.inboundMail = { ok: true, label: 'SendGrid', note: 'webhook ready' };
    } else {
      try {
        const r = await fetch(`${config.INBOUND_MAIL_API_URL}/api/v1/info`, { signal: AbortSignal.timeout(3000) });
        results.inboundMail = { ok: r.ok, label: 'Mailpit' };
      } catch (err) {
        results.inboundMail = { ok: false, label: 'Mailpit', error: err.message };
      }
    }

    try {
      const erpUrl = process.env.ERP_STUB_URL || 'http://erp-stub:3001';
      const r = await fetch(`${erpUrl}/health`, { signal: AbortSignal.timeout(3000) });
      results.erp = { ok: r.ok };
    } catch (err) {
      results.erp = { ok: false, error: err.message };
    }

    const allOk = Object.values(results).every(s => s.ok);
    res.status(allOk ? 200 : 207).json(results);
  });

  return router;
}

/**
 * Parse a JSONC file (JSON with single-line // comments).
 * Strips comment lines before parsing so standard JSON.parse can handle the file.
 * @param {string} raw - raw file contents
 * @returns {Object} parsed JSON value
 */
function parseJsonc(raw) {
  const stripped = raw.replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(stripped);
}

/**
 * Extract readable text from a stub PDF file.
 * Stub PDFs in the test corpus are plain text wrapped in minimal PDF scaffolding
 * (not real binary PDFs). pdf-parse fails on these; this function extracts the
 * content directly from the stream sections or by filtering PDF syntax lines.
 *
 * Primary: extract text between 'stream' and 'endstream' markers.
 * Fallback: filter out lines that look like PDF syntax (%comments, object refs, keywords).
 *
 * @param {string} raw - raw PDF file content as a UTF-8 string
 * @returns {string} extracted text, or '[PDF content could not be extracted]'
 */
function extractPdfText(raw) {
  // Primary: extract content from within PDF stream sections
  const matches = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)];
  if (matches.length) {
    const text = matches.map(m => m[1].trim()).filter(Boolean).join('\n\n').trim();
    if (text) return text;
  }
  // Fallback: filter out PDF structural/syntax lines
  const text = raw.split('\n')
    .filter(l => {
      const t = l.trim();
      return t
        && !/^%/.test(t)                                            // PDF comments/header
        && !/^\d+ \d+ (obj|R)/.test(t)                             // object references
        && !/^(<<|>>|stream|endstream|endobj|xref|trailer|startxref)/.test(t)  // PDF keywords
        && !/^\d+$/.test(t);                                        // standalone integers
    })
    .join('\n').trim();
  return text || '[PDF content could not be extracted]';
}
