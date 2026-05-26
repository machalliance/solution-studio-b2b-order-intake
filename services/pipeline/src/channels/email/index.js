/**
 * @file index.js
 * @description Email channel factory. Returns the adapter selected by INBOUND_MAIL_PROVIDER.
 *
 * Supported providers:
 *   mailpit  (default) - polls Mailpit REST API; for local dev and Docker testing
 *   sendgrid           - receives SendGrid Inbound Parse webhook POSTs; for production
 *
 * Both adapters implement the same interface:
 *   start(onMessage)  - begin receiving messages
 *   stop()            - halt the channel
 *   resetSeen()       - clear dedup state (mailpit only; no-op for sendgrid)
 *   router            - optional Express Router (sendgrid only; undefined for mailpit)
 * @module channels/email
 */
import { config }                from '../../config.js';
import { MailpitEmailAdapter }   from './mailpit.js';
import { SendGridInboundAdapter } from './sendgrid-inbound.js';

/**
 * Instantiate the email inbound channel adapter selected by INBOUND_MAIL_PROVIDER.
 * @returns {MailpitEmailAdapter | SendGridInboundAdapter}
 */
export function createEmailChannel() {
  const provider = config.INBOUND_MAIL_PROVIDER;
  if (provider === 'sendgrid') {
    return new SendGridInboundAdapter();
  }
  return new MailpitEmailAdapter();
}
