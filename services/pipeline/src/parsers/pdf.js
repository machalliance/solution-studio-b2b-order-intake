/**
 * @file pdf.js
 * @description PDF content parser - extracts text from text-based PDFs.
 *              Scanned PDFs produce minimal text -> low confidence -> Human Review.
 * @module parsers/pdf
 */
import pdfParse from 'pdf-parse';
import { config } from '../config.js';

function extractPdfText(raw) {
  // Try to extract text between stream/endstream markers
  const matches = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)];
  if (matches.length) {
    const text = matches.map(m => m[1].trim()).filter(Boolean).join('\n\n').trim();
    if (text) return text;
  }
  // Strip all PDF structural lines and comments
  const text = raw.split('\n')
    .filter(l => {
      const t = l.trim();
      return t
        && !/^%/.test(t)
        && !/^\d+ \d+ (obj|R)/.test(t)
        && !/^(<<|>>|stream|endstream|endobj|xref|trailer|startxref)/.test(t)
        && !/^\d+$/.test(t);
    })
    .join('\n').trim();
  return text || '[PDF content could not be extracted]';
}

/** @see config.PDF_MIN_TEXT_LENGTH */

export class PDFParser {
  get supportedTypes() { return ['application/pdf']; }

  /**
   * @param {Object} message
   * @returns {Promise<{text: string, contentType: string, warning?: string}>}
   */
  async parse(message) {
    const attachment = (message.attachments || []).find(
      a => a.contentType?.includes('pdf') || a.filename?.endsWith('.pdf')
    );
    if (!attachment) throw new Error('PDF parser: no PDF attachment found');

    let text = '';
    try {
      const data = await pdfParse(attachment.content);
      text = data.text?.trim() || '';
    } catch {
      // Stub/malformed PDFs (plain text with %PDF header) - extract from scaffolding
      text = extractPdfText(attachment.content.toString('utf8'));
    }

    const result = { text, contentType: 'pdf' };
    if (text.length < config.PDF_MIN_TEXT_LENGTH) {
      result.warning = 'PDF appears to be scanned or image-only - minimal text extracted';
    }
    return result;
  }
}
