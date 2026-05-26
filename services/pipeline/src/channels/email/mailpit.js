/**
 * @file mailpit.js
 * @description Mailpit email channel adapter. Polls the Mailpit REST API for new inbound
 *              messages and hands each one to the LangGraph pipeline via the onMessage
 *              callback. Selected when INBOUND_MAIL_PROVIDER=mailpit (default, dev).
 *
 * Startup sequence:
 *   1. Wait for Mailpit to become reachable (exponential back-off, max 20 attempts)
 *   2. Seed _seen set with all existing Mailpit messages (prevents reprocessing on restart)
 *   3. Start the poll loop at INBOUND_MAIL_POLL_INTERVAL_MS intervals
 *
 * Self-sent messages (PIPELINE_NOTIFICATION_FROM) are filtered out to prevent
 * clarification replies from re-entering the pipeline.
 * @module channels/email/mailpit
 */
import { simpleParser } from 'mailparser';
import { config }       from '../../config.js';
import { logger }       from '../../util/logger.js';

export class MailpitEmailAdapter {
  constructor() {
    this.pollIntervalMs = config.INBOUND_MAIL_POLL_INTERVAL_MS;
    this.baseUrl        = config.INBOUND_MAIL_API_URL;
    // Filter out emails sent BY the pipeline - otherwise clarification replies loop back in
    this.ownFrom        = process.env.PIPELINE_NOTIFICATION_FROM || 'b2b-intake@localhost';
    this._timer         = null;
    this._running       = false;
    this._seen          = new Set();  // message IDs already processed or pre-existing at startup
    this.name           = 'mailpit';
  }

  /**
   * Start polling. Waits for Mailpit before beginning.
   * @param {Function} onMessage - async callback receiving a normalised channel message object
   */
  async start(onMessage) {
    this._onMessage = onMessage;
    this._running   = true;
    await this._waitForMailpit();
    // Seed before first poll so existing messages at startup are not reprocessed
    await this._seedSeen();
    this._poll();
  }

  /**
   * Mark all messages currently in Mailpit as seen so pipeline restarts don't
   * reprocess messages that were already handled in a previous session.
   */
  async _seedSeen() {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/messages?limit=500`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return;
      const { messages = [] } = await res.json();
      for (const m of messages) this._seen.add(m.ID);
      if (messages.length > 0)
        logger.info({ count: messages.length }, 'Email channel: seeded existing messages as already-seen');
    } catch {
      // Non-fatal - worst case we reprocess a few messages on restart
    }
  }

  /** Stop the poll loop. Does not drain in-flight messages. */
  async stop() {
    this._running = false;
    clearTimeout(this._timer);
  }

  /**
   * Clear the seen-set. Used by POST /api/test/clear to allow re-processing
   * test messages after a data reset.
   */
  resetSeen() {
    this._seen.clear();
  }

  /**
   * Wait until Mailpit is reachable before starting the poll loop.
   * Uses linear back-off capped at 15 s; continues anyway after 20 failed attempts
   * to avoid blocking the whole pipeline startup.
   * @param {number} attempt - current attempt count (1-based)
   */
  async _waitForMailpit(attempt = 1) {
    const maxAttempts = 20;
    const delayMs     = Math.min(2000 * attempt, 15000);
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/messages`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        logger.info({ attempt }, 'Email channel: Mailpit ready');
        return;
      }
    } catch {
      // Not ready yet - fall through to retry
    }
    if (attempt >= maxAttempts) {
      logger.warn('Email channel: Mailpit not reachable after maximum attempts - poll loop starting anyway');
      return;
    }
    logger.debug({ attempt, maxAttempts }, 'Email channel: waiting for Mailpit');
    await new Promise(r => setTimeout(r, delayMs));
    return this._waitForMailpit(attempt + 1);
  }

  /** Schedule the next poll tick. Errors in _fetchAndProcess do not stop the loop. */
  _poll() {
    if (!this._running) return;
    this._timer = setTimeout(async () => {
      try {
        await this._fetchAndProcess();
      } catch (err) {
        logger.error({ err }, 'Email channel poll error');
      } finally {
        this._poll();
      }
    }, this.pollIntervalMs);
  }

  /**
   * Fetch new messages from Mailpit, parse each one, and invoke the pipeline callback.
   * Message ID is added to _seen BEFORE the callback so a slow graph run doesn't
   * cause the same message to be picked up on the next poll tick.
   */
  async _fetchAndProcess() {
    const res = await fetch(`${this.baseUrl}/api/v1/messages`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Mailpit API error: ${res.status}`);
    const data     = await res.json();
    // Filter out messages already processed and our own outbound clarification emails
    const messages = (data.messages || []).filter(m =>
      !this._seen.has(m.ID) && m.From?.Address !== this.ownFrom
    );
    if (messages.length > 0) {
      logger.info({ count: messages.length }, 'Email channel: new messages found');
    }

    for (const msg of messages) {
      // Fetch the raw RFC-2822 message for full header and attachment parsing
      const rawRes = await fetch(`${this.baseUrl}/api/v1/message/${msg.ID}/raw`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!rawRes.ok) continue;
      const rawEmail = await rawRes.text();

      const parsed = await simpleParser(rawEmail);
      // Mark as seen before callback - prevents re-queuing on slow graph runs
      this._seen.add(msg.ID);
      logger.info({ from: parsed.from?.text }, 'Email channel: processing message');

      const message = {
        channel:     'email',
        senderEmail: parsed.from?.value?.[0]?.address || null,
        subject:     parsed.subject || '',
        body:        parsed.text   || '',
        html:        parsed.html   || '',
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
          setTimeout(() => reject(new Error(`Graph timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
    }
  }
}
