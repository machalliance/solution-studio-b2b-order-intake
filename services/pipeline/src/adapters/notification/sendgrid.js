/**
 * @file sendgrid.js
 * @description SendGrid notification adapter for production email delivery.
 *              Selected when EMAIL_PROVIDER=sendgrid in .env.
 *
 * Required env vars:
 *   SENDGRID_API_KEY     - SendGrid API key
 *   SENDGRID_FROM_EMAIL  - verified sender address
 *   INQUIRY_CONTACT_EMAIL - shown in auto-replies to non-order enquiries
 *
 * This adapter implements the same sendClarification() interface as
 * MailpitNotificationAdapter - swapping EMAIL_PROVIDER between the two
 * adapters must produce identical outbound behaviour.
 * @module adapters/notification/sendgrid
 */
import sgMail from '@sendgrid/mail';

export class SendGridNotificationAdapter {
  constructor() {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    this.from = process.env.SENDGRID_FROM_EMAIL;
    if (!this.from) throw new Error('SENDGRID_FROM_EMAIL must be set when EMAIL_PROVIDER=sendgrid');
  }

  /**
   * Send a clarification email to the buyer via SendGrid.
   * Signature is identical to MailpitNotificationAdapter.sendClarification().
   *
   * @param {string} recipient           - buyer's email address
   * @param {Object|null} order          - MACH ODM Order entity (may be partial or null)
   * @param {Object} clarifications
   * @param {string[]} clarifications.validationErrors  - error codes from validation
   * @param {Object[]} clarifications.skuCandidates     - { lineNumber, buyerSku, suggestions[] }
   * @param {Object[]} clarifications.customerCandidates - unused in outbound (operator-only)
   * @param {string}  [clarifications.operatorNotes]    - free-text note added by operator
   * @param {boolean} [clarifications.unreadable]       - true if document could not be parsed
   * @param {boolean} [clarifications.inquiry]          - true if document was an inquiry, not a PO
   * @param {string} channel             - 'email' | 'edi'
   * @returns {Promise<{ sent: boolean, messageId: string }>}
   */
  async sendClarification(recipient, order, clarifications, channel) {
    const { validationErrors = [], skuCandidates = [], operatorNotes, unreadable, inquiry } = clarifications;
    const body = buildClarifyEmail(order, validationErrors, skuCandidates, operatorNotes, unreadable, inquiry);

    const subject = unreadable
      ? `Unable to Process Your Submission - Please Resubmit`
      : inquiry
        ? `Re: Your Enquiry`
        : `Re: Purchase Order ${order?.poNumber || ''} - Clarification Required`;

    const info = await sgMail.send({
      to:      recipient,
      from:    this.from,
      subject,
      text:    body,
    });

    return { sent: true, messageId: `sendgrid-${Date.now()}`, subject, body };
  }
}

/**
 * Build plain-text body - mirrors MailpitNotificationAdapter.buildClarifyEmail exactly.
 * Any changes to the email body format must be applied to both adapters.
 */
function buildClarifyEmail(order, validationErrors, skuCandidates, operatorNotes, unreadable, inquiry) {
  if (inquiry) {
    const contactEmail = process.env.INQUIRY_CONTACT_EMAIL || 'sales@example.com';
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

  const headerErrors = validationErrors.filter(e =>
    e.startsWith('missing_') && !e.startsWith('missing_line')
  );
  const lineErrors = {};
  for (const e of validationErrors) {
    const m = e.match(/^line_(\d+)_(.+)$/);
    if (m) {
      lineErrors[m[1]] = lineErrors[m[1]] || [];
      lineErrors[m[1]].push(m[2].replace(/_/g, ' '));
    }
  }

  const lines = [
    `Thank you for your purchase order${order?.poNumber ? ` ${order.poNumber}` : ''}.`,
    '',
    'We were unable to fully process your order. Below is a summary of what we received,',
    'with the items requiring clarification marked with [?].',
    '', 'ORDER DETAILS', '-'.repeat(40),
    `  PO Number   : ${order?.poNumber   || (headerErrors.includes('missing_poNumber')   ? '[? required]' : '-')}`,
    `  Order Date  : ${order?.orderDate  || (headerErrors.includes('missing_orderDate')  ? '[? required]' : '-')}`,
    `  Currency    : ${order?.currency   || '-'}`,
  ];

  const buyer = order?.buyer || {};
  lines.push('', '  Buyer:');
  lines.push(`    Company : ${buyer.companyName || (headerErrors.includes('missing_buyer_company') ? '[? required]' : '-')}`);
  lines.push(`    Email   : ${buyer.email       || (headerErrors.includes('missing_buyer_email')  ? '[? required]' : '-')}`);
  lines.push(`    Account : ${buyer.accountId   || '-'}`);

  const items = order?.lineItems || [];
  if (items.length) {
    lines.push('', '  Line Items:');
    for (const item of items) {
      const n    = String(item.lineNumber);
      const errs = lineErrors[n] || [];
      lines.push(`    Line ${n}${errs.length ? ' [?]' : ''}: ${item.productDescription || item.buyerSku || '-'}`);
      lines.push(`      SKU       : ${item.buyerSku    || '-'}`);
      lines.push(`      Qty       : ${item.quantity    != null ? item.quantity    : errs.includes('missing quantity') ? '[? required]' : '-'}`);
      lines.push(`      UOM       : ${item.unitOfMeasure != null ? item.unitOfMeasure : '-'}`);
      lines.push(`      Unit Price: ${item.unitPrice   != null ? item.unitPrice   : '-'}`);
      if (errs.length) lines.push(`      Issues    : ${errs.join(', ')}`);
    }
  }

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
