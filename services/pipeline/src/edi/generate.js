/**
 * @file generate.js
 * @description Generates outbound X12 EDI transaction sets for the EDI channel.
 *
 * Transaction sets produced:
 *   864 Text Message       - sent when clarification is needed from the trading partner
 *   855 Purchase Order Acknowledgement - sent to reject an inbound 850 PO
 *
 * ISA interchange envelope: sender/receiver IDs are extracted from the inbound 850
 * and swapped on the outbound envelope so the message is addressed correctly.
 *
 * X12 version: 005010 (X12N / ANSI X12 version 5010)
 */

/**
 * Parse ISA segment fields from a raw X12 document.
 * The ISA segment is always the first segment and has a fixed 106-character format,
 * but we parse by field delimiter ('*') for robustness.
 *
 * @param {string} rawEdi - raw X12 document text
 * @returns {{ senderQual: string, senderId: string, receiverQual: string, receiverId: string }|null}
 *   null if the document does not start with a valid ISA segment
 */
export function parseISA(rawEdi) {
  const firstSeg = rawEdi.trim().slice(0, 200);
  const fields   = firstSeg.split('*');
  if (fields[0] !== 'ISA' || fields.length < 13) return null;
  return {
    senderQual:   fields[5]?.trim() || 'ZZ',
    senderId:     fields[6]?.trim() || 'UNKNOWN',
    receiverQual: fields[7]?.trim() || 'ZZ',
    receiverId:   fields[8]?.trim() || 'B2BINTAKE',
  };
}

/**
 * Build an X12 864 Text Message (clarification request).
 * Sender and receiver IDs are swapped from the inbound 850 ISA so the reply
 * is addressed to the trading partner that sent the original order.
 *
 * Each message line becomes an NTE segment; NTE text is truncated to 264 chars
 * and stripped of X12 delimiters ('~', '*') to avoid corrupting the envelope.
 *
 * @param {string|null} poNumber     - PO number for reference in the message header
 * @param {{ senderQual, senderId, receiverQual, receiverId }|null} isa - parsed ISA from inbound 850
 * @param {string[]} messageLines    - human-readable lines to include as NTE segments
 * @returns {string} complete X12 864 document (segments joined with '~\n')
 */
export function generate864(poNumber, isa, messageLines) {
  const { dateStr, timeStr, controlNum } = nowParts();
  // Swap sender/receiver: we are the original receiver, now sending back as sender
  const from  = isa?.receiverId?.trim() || 'B2BINTAKE';
  const to    = isa?.senderId?.trim()   || 'TRADINGPARTNER';
  const fromQ = isa?.receiverQual || 'ZZ';
  const toQ   = isa?.senderQual   || 'ZZ';

  const nteLine  = messageLines.map(l => `NTE**${l.slice(0, 264).replace(/[~*]/g, ' ')}`);
  // SE segment count = ST + BMG + all NTE lines + SE itself (so +1 is added below)
  const segCount = 3 + nteLine.length; // ST(1) + BMG(1) + NTE(n); SE adds itself

  const segs = [
    `ISA*00*          *00*          *${fromQ}*${pad15(from)}*${toQ}*${pad15(to)}*${dateStr.slice(2)}*${timeStr}*^*00501*${controlNum}*0*P*>`,
    `GS*TX*${from}*${to}*${dateStr}*${timeStr}*1*X*005010`,
    `ST*864*0001`,
    `BMG*00*${dateStr}*1`,
    ...nteLine,
    `SE*${segCount + 1}*0001`,
    `GE*1*1`,
    `IEA*1*${controlNum}`,
  ];
  return segs.join('~\n') + '~';
}

/**
 * Build an X12 855 Purchase Order Acknowledgement with rejection status (BAK02=RJ).
 * Sent in response to an inbound 850 that cannot be fulfilled.
 *
 * @param {string|null} poNumber    - original PO number from the 850
 * @param {string|null} orderDate   - original order date (ISO or YYYYMMDD); falls back to today
 * @param {{ senderQual, senderId, receiverQual, receiverId }|null} isa - parsed ISA from inbound 850
 * @returns {string} complete X12 855 document
 */
export function generate855(poNumber, orderDate, isa) {
  const { dateStr, timeStr, controlNum } = nowParts();
  const from  = isa?.receiverId?.trim() || 'B2BINTAKE';
  const to    = isa?.senderId?.trim()   || 'TRADINGPARTNER';
  const fromQ = isa?.receiverQual || 'ZZ';
  const toQ   = isa?.senderQual   || 'ZZ';
  // BAK04 requires YYYYMMDD format - strip ISO dashes if present
  const poDate = (orderDate || '').replace(/-/g, '') || dateStr;

  const segs = [
    `ISA*00*          *00*          *${fromQ}*${pad15(from)}*${toQ}*${pad15(to)}*${dateStr.slice(2)}*${timeStr}*^*00501*${controlNum}*0*P*>`,
    `GS*PR*${from}*${to}*${dateStr}*${timeStr}*1*X*005010`,
    `ST*855*0001`,
    // BAK02=RJ - Rejected (X12 Purchase Order Acknowledgement Status code)
    `BAK*00*RJ*${poNumber || 'UNKNOWN'}*${poDate}`,
    `CTT*0`,   // no line items on a rejection
    `SE*4*0001`,
    `GE*1*1`,
    `IEA*1*${controlNum}`,
  ];
  return segs.join('~\n') + '~';
}

/**
 * Build the human-readable NTE message lines for an 864 from validation errors.
 * Each returned string will become one NTE segment (truncated to 264 chars).
 *
 * @param {string|null} poNumber       - PO number for the message header
 * @param {string[]} validationErrors  - error codes from validation node
 * @param {string|null} operatorNotes  - free-text note added by the reviewing operator
 * @returns {string[]} array of message lines for use in generate864()
 */
export function build864MessageLines(poNumber, validationErrors, operatorNotes) {
  const lines = [];
  lines.push(`Re: Purchase Order ${poNumber || 'unknown'}`);
  lines.push(`We were unable to process the above order and require clarification.`);

  // Separate header-level errors from line-level errors for clearer messaging
  const headerErrors = (validationErrors || []).filter(e => e.startsWith('missing_'));
  const lineErrors   = (validationErrors || []).filter(e => /^line_\d+_/.test(e));

  if (headerErrors.length) {
    lines.push(`Missing required fields: ${headerErrors.map(e => e.replace('missing_', '').replace(/_/g, ' ')).join(', ')}.`);
  }
  if (lineErrors.length) {
    for (const e of lineErrors) {
      const m = e.match(/^line_(\d+)_(.+)$/);
      if (m) lines.push(`Line ${m[1]}: missing ${m[2].replace(/_/g, ' ')}.`);
    }
  }
  if (operatorNotes) {
    lines.push(`Additional notes: ${operatorNotes}`);
  }
  lines.push(`Please resubmit a corrected 850 or contact us to resolve.`);
  return lines;
}

/**
 * Write an outbound EDI document to the configured edi-outbound directory.
 * Used by the reject node (855) and clarify node (864) so both share the
 * same path resolution and filename convention.
 *
 * @param {'864'|'855'} type
 * @param {string|null}  poNumber
 * @param {string}       content  - complete X12 document string
 * @returns {Promise<string>} filename that was written (without path)
 */
export async function writeEdiOutbound(type, poNumber, content) {
  const { writeFile, mkdir } = await import('fs/promises');
  const { join }             = await import('path');
  const { config }           = await import('../config.js');
  const outPath  = config.EDI_OUTBOUND_PATH;
  await mkdir(outPath, { recursive: true });
  const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safe     = (poNumber || 'UNKNOWN').replace(/[^A-Za-z0-9-]/g, '_');
  const filename = `${type}_${safe}_${ts}.edi`;
  await writeFile(join(outPath, filename), content, 'utf8');
  return filename;
}

// -- private helpers -----------------------------------------------------------

/**
 * Generate X12-compatible date, time, and control number strings for right now.
 * @returns {{ dateStr: string, timeStr: string, controlNum: string }}
 */
function nowParts() {
  const now        = new Date();
  const dateStr    = now.toISOString().slice(0, 10).replace(/-/g, '');  // YYYYMMDD
  const timeStr    = now.toISOString().slice(11, 16).replace(':', '');  // HHMM
  // 9-digit control number derived from epoch milliseconds - unique within a session
  const controlNum = String(Date.now()).slice(-9).padStart(9, '0');
  return { dateStr, timeStr, controlNum };
}

/**
 * Pad or truncate a string to exactly 15 characters for ISA ID fields.
 * @param {string} s
 * @returns {string} 15-character string (padded with spaces)
 */
function pad15(s) {
  return (s || '').slice(0, 15).padEnd(15);
}
