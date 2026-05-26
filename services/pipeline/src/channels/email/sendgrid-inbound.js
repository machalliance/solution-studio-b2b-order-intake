/**
 * @file sendgrid-inbound.js
 * @description SendGrid Inbound Parse email channel adapter. Receives inbound email
 *              as webhook POSTs from SendGrid and hands each message to the LangGraph
 *              pipeline via the onMessage callback. Selected when INBOUND_MAIL_PROVIDER=sendgrid.
 *
 * SendGrid Inbound Parse posts multipart/form-data to the configured webhook URL.
 * The `email` field contains the full raw RFC-2822 message, parsed here with mailparser.
 * The webhook must be publicly reachable; configure the URL in the SendGrid dashboard:
 *   Host: <your domain>  |  URL: POST /api/v1/email/inbound
 *
 * This adapter exposes a `router` property (Express Router) that the pipeline mounts
 * at /api/v1 alongside the main API router. No polling - SendGrid pushes messages.
 *
 * Required SendGrid dashboard settings:
 *   - Inbound Parse -> Webhook URL: https://<host>/api/v1/email/inbound
 *   - "POST the raw, full MIME message" checkbox: ENABLED
 *
 * Required env vars (production only):
 *   SENDGRID_INBOUND_WEBHOOK_KEY  - optional bearer token checked against X-Webhook-Key header
 *
 * @module channels/email/sendgrid-inbound
 */
import { Router }       from 'express';
import multer           from 'multer';
import { simpleParser } from 'mailparser';
import { config }       from '../../config.js';
import { logger }       from '../../util/logger.js';

// multer with no-file-storage mode parses multipart/form-data text fields only.
// File attachments from the original email are embedded in the raw MIME content
// and extracted by mailparser - multer does not need to handle them separately.
// fieldSize raised to 25MB - raw MIME with PDF attachments can be large.
const upload = multer({ limits: { fieldSize: 25 * 1024 * 1024 } });

export class SendGridInboundAdapter {
  constructor() {
    this.name     = 'sendgrid';
    this._running = false;
    // Router is built upfront so index.js can mount it before the server starts.
    // Route: POST /api/v1/email/inbound (mounted under /api/v1 by index.js)
    this.router = Router();
    this.router.post('/email/inbound', upload.none(), (req, res) => this._handleWebhook(req, res));
  }

  /**
   * Store the message callback. No poll loop - delivery is push-based via webhook.
   * @param {Function} onMessage - async callback receiving a normalised channel message object
   */
  async start(onMessage) {
    this._onMessage = onMessage;
    this._running   = true;
    // Filter out emails sent BY the pipeline - same address the notification adapter sends from
    this._ownFrom   = process.env.PIPELINE_NOTIFICATION_FROM || 'b2b-intake@localhost';
    logger.info('SendGrid inbound email channel ready - awaiting POST /api/v1/email/inbound');
  }

  async stop() {
    this._running = false;
  }

  /** No-op - webhooks are delivered once; no deduplication needed. */
  resetSeen() {}

  /**
   * Handle a SendGrid Inbound Parse webhook POST.
   * Responds 200 immediately (SendGrid requires a fast ack), then processes async.
   */
  async _handleWebhook(req, res) {
    if (!this._running) return res.status(503).json({ error: 'Channel not started' });

    // Optional webhook key validation - set SENDGRID_INBOUND_WEBHOOK_KEY in .env
    const webhookKey = process.env.SENDGRID_INBOUND_WEBHOOK_KEY;
    if (webhookKey && req.headers['x-webhook-key'] !== webhookKey) {
      logger.warn({ ip: req.ip }, 'SendGrid inbound: rejected request with invalid webhook key');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const rawEmail = req.body?.email;
    if (!rawEmail) {
      logger.warn({ body: Object.keys(req.body || {}) }, 'SendGrid inbound webhook: missing email field');
      return res.status(400).json({ error: 'Missing email field in multipart payload' });
    }

    // Filter self-sent emails (clarification replies) before they re-enter the pipeline
    const fromAddr = (req.body?.from || '').toLowerCase();
    if (fromAddr && this._ownFrom && fromAddr.includes(this._ownFrom.toLowerCase())) {
      logger.debug({ from: fromAddr }, 'SendGrid inbound: dropped self-sent message');
      return res.status(200).json({ received: true, skipped: 'self-sent' });
    }

    // Respond 200 before processing - SendGrid retries if it doesn't get a fast 2xx
    res.status(200).json({ received: true });

    // Process asynchronously so slow graph runs don't time out the webhook connection
    setImmediate(async () => {
      try {
        const parsed = await simpleParser(rawEmail);
        logger.info({ from: parsed.from?.text, subject: parsed.subject }, 'SendGrid inbound: processing message');

        const message = {
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
        };

        const timeoutMs = config.GRAPH_TIMEOUT_MS;
        await Promise.race([
          this._onMessage(message),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Graph timeout after ${timeoutMs}ms`)), timeoutMs),
          ),
        ]);
      } catch (err) {
        logger.error({ err }, 'SendGrid inbound: error processing webhook message');
      }
    });
  }
}
