/**
 * @file mailpit.js
 * @description Mailpit SMTP notification adapter using nodemailer. In production,
 *              replace with a real SMTP relay (SES, SendGrid, etc.) by implementing
 *              the same sendClarification() interface in a new adapter class.
 *
 * All SMTP configuration is via env vars (Cloud-native / MACH-C):
 *   SMTP_HOST (default 'mailpit')
 *   SMTP_PORT (default 1025)
 *   PIPELINE_NOTIFICATION_FROM (default 'b2b-intake@localhost')
 * @module adapters/notification/mailpit
 */
import nodemailer   from 'nodemailer';
import { config }   from '../../config.js';

export class MailpitNotificationAdapter {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host:   config.SMTP_HOST,
      port:   config.SMTP_PORT,
      secure: false, // plain SMTP; TLS is terminated upstream in production
    });
    this.from = process.env.PIPELINE_NOTIFICATION_FROM || 'b2b-intake@localhost';
  }

  /**
   * Send a clarification email to the buyer. The message content is tailored by mode:
   *   - unreadable: ask for a legible resubmission
   *   - inquiry:    redirect to the sales/support contact
   *   - standard:   list specific missing or ambiguous fields
   *
   * @param {string} recipient           - buyer's From address
   * @param {Object|null} order          - MACH ODM Order entity (may be partial or null for unreadable)
   * @param {Object} clarifications
   * @param {string[]} clarifications.validationErrors  - error codes from validation
   * @param {Object[]} clarifications.skuCandidates     - { lineNumber, buyerSku, suggestions[] }
   * @param {Object[]} clarifications.customerCandidates - unused in outbound email (operator-only)
   * @param {string}  [clarifications.operatorNotes]    - free-text note added by operator
   * @param {boolean} [clarifications.unreadable]       - true if document could not be parsed
   * @param {boolean} [clarifications.inquiry]          - true if document was an inquiry, not a PO
   * @param {string} channel             - 'email' | 'edi' (email-only; EDI uses 864 transactions)
   * @returns {Promise<{ sent: boolean, messageId: string }>}
   */
  async sendClarification(recipient, order, clarifications, channel) {
    const { validationErrors = [], skuCandidates = [], operatorNotes, unreadable, inquiry } = clarifications;
    const body = buildClarifyEmail(order, validationErrors, skuCandidates, operatorNotes, unreadable, inquiry);

    // Subject line is tailored to the clarification mode so the buyer immediately
    // understands what action is required
    const subject = unreadable
      ? `Unable to Process Your Submission - Please Resubmit`
      : inquiry
        ? `Re: Your Enquiry`
        : `Re: Purchase Order ${order?.poNumber || ''} - Clarification Required`;

    const info = await this.transporter.sendMail({
      from:    this.from,
      to:      recipient,
      subject,
      text:    body,
    });

    return { sent: true, messageId: info.messageId, subject, body };
  }
}

/**
 * Build the plain-text body for a clarification email.
 * @param {Object|null} order
 * @param {string[]} validationErrors
 * @param {Object[]} skuCandidates
 * @param {string|undefined} operatorNotes
 * @param {boolean} unreadable
 * @param {boolean} inquiry
 * @returns {string}
 */
function buildClarifyEmail(order, validationErrors, skuCandidates, operatorNotes, unreadable, inquiry) {
  if (inquiry) {
    const contactEmail = process.env.INQUIRY_CONTACT_EMAIL || process.env.NOTIFICATION_FROM || 'sales@example.com';
    return [
      `Thank you for your message.`,
      ``,
      `This inbox is dedicated to purchase order processing only and is not monitored for general enquiries.`,
      ``,
      `For stock availability, lead times, quotes, or other questions please contact us at:`,
      `  ${contactEmail}`,
      ``,
      `If you intended to submit a purchase order, please resend with your PO details.`,
    ].join('\n');
  }

  if (unreadable) {
    return [
      `Thank you for your submission.`,
      ``,
      `We received your email but were unable to extract any order information from the attached document.`,
      `This typically happens when:`,
      `  - The PDF is a scanned image without selectable text`,
      `  - The attachment is corrupted or in an unsupported format`,
      `  - The document content is blank or too degraded to read`,
      ``,
      `Please resubmit your order using one of the following:`,
      `  - A text-based (machine-readable) PDF`,
      `  - A CSV or XLSX spreadsheet`,
      `  - The order details typed directly in the email body`,
      ``,
      `If you have questions, please contact us directly.`,
    ].join('\n');
  }
  // Classify errors: which apply to the header, which to specific lines
  const headerErrors = validationErrors.filter(e =>
    e.startsWith('missing_') && !e.startsWith('missing_line')
  );
  const lineErrors = {};  // lineNumber -> [error strings]
  for (const e of validationErrors) {
    const m = e.match(/^line_(\d+)_(.+)$/);
    if (m) {
      const n = m[1];
      lineErrors[n] = lineErrors[n] || [];
      lineErrors[n].push(m[2].replace(/_/g, ' '));
    }
  }

  const lines = [
    `Thank you for your purchase order${order?.poNumber ? ` ${order.poNumber}` : ''}.`,
    '',
    'We were unable to fully process your order. Below is a summary of what we received,',
    'with the items requiring clarification marked with [?].',
  ];

  // -- Order header ----------------------------------------------------------
  lines.push('', 'ORDER DETAILS', '-'.repeat(40));
  lines.push(`  PO Number   : ${order?.poNumber   || (headerErrors.includes('missing_poNumber')   ? '[? required]' : '-')}`);
  lines.push(`  Order Date  : ${order?.orderDate  || (headerErrors.includes('missing_orderDate')  ? '[? required]' : '-')}`);
  lines.push(`  Currency    : ${order?.currency   || '-'}`);

  const buyer = order?.buyer || {};
  lines.push('', '  Buyer:');
  lines.push(`    Company : ${buyer.companyName || (headerErrors.includes('missing_buyer_company') ? '[? required]' : '-')}`);
  lines.push(`    Email   : ${buyer.email       || (headerErrors.includes('missing_buyer_email')  ? '[? required]' : '-')}`);
  lines.push(`    Account : ${buyer.accountId   || '-'}`);

  // -- Line items ------------------------------------------------------------
  const items = order?.lineItems || [];
  if (items.length) {
    lines.push('', '  Line Items:');
    for (const item of items) {
      const n        = String(item.lineNumber);
      const errs     = lineErrors[n] || [];
      const flag     = errs.length ? ' [?]' : '';
      lines.push(`    Line ${n}${flag}: ${item.productDescription || item.buyerSku || '-'}`);
      lines.push(`      SKU      : ${item.buyerSku    || '-'}`);
      lines.push(`      Qty      : ${item.quantity    != null ? item.quantity    : errs.includes('missing quantity') ? '[? required]' : '-'}`);
      lines.push(`      UOM      : ${item.unitOfMeasure != null ? item.unitOfMeasure : '-'}`);
      lines.push(`      Unit Price: ${item.unitPrice  != null ? item.unitPrice   : '-'}`);
      if (errs.length) {
        lines.push(`      Issues   : ${errs.join(', ')}`);
      }
    }
  }

  // -- SKU clarifications ----------------------------------------------------
  if (skuCandidates.length) {
    lines.push('', '  Unrecognised product references:');
    for (const s of skuCandidates) {
      lines.push(`    Line ${s.lineNumber} - "${s.buyerSku}":`);
      if (s.suggestions?.length) {
        lines.push('    Possible matches from our catalogue:');
        for (const sug of s.suggestions) lines.push(`      - ${sug}`);
      } else {
        lines.push('    No close matches found - please provide a valid product code.');
      }
    }
  }

  if (operatorNotes) {
    lines.push('', 'Additional notes from our team:');
    lines.push(`  ${operatorNotes}`);
  }

  lines.push('', '-'.repeat(40));
  lines.push('Please reply with the corrected or missing information and we will reprocess your order.');
  lines.push('If you have questions, please contact us directly.');
  return lines.join('\n');
}
