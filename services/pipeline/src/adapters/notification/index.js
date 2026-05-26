/**
 * @file index.js
 * @description Notification adapter factory. Selected via EMAIL_PROVIDER in .env.
 *
 * Interface contract - a replacement adapter must implement:
 * @module adapters/notification
 */

/**
 * @typedef {Object} NotificationAdapter
 * @property {function(
 *   to:      string,
 *   order:   Object|null,
 *   options: {
 *     validationErrors?:   string[],
 *     skuCandidates?:      Array,
 *     customerCandidates?: Array,
 *     operatorNotes?:      string,
 *     unreadable?:         boolean,
 *     inquiry?:            boolean
 *   },
 *   channel: string
 * ): Promise<{
 *   sent:      boolean,
 *   messageId: string,
 *   subject:   string,
 *   body:      string
 * }>} sendClarification - Send a clarification request to the buyer
 */

import { MailpitNotificationAdapter }  from './mailpit.js';
import { SendGridNotificationAdapter } from './sendgrid.js';

export function createNotificationAdapter() {
  const provider = process.env.EMAIL_PROVIDER || 'mailpit';
  switch (provider) {
    case 'mailpit':  return new MailpitNotificationAdapter();
    case 'sendgrid': return new SendGridNotificationAdapter();
    default: throw new Error(`Unknown EMAIL_PROVIDER: "${provider}". Valid values: mailpit, sendgrid`);
  }
}
