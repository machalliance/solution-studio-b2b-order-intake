/**
 * @file index.js
 * @description Content parser factory.
 * @module parsers
 */
import { TextParser }  from './text.js';
import { PDFParser }   from './pdf.js';
import { CSVParser }   from './csv.js';
import { XLSXParser }  from './xlsx.js';
import { X12Parser }   from './x12.js';

const PARSERS = {
  plain_text: new TextParser(),
  pdf:        new PDFParser(),
  csv:        new CSVParser(),
  xlsx:       new XLSXParser(),
  x12_850:    new X12Parser(),
};

/**
 * @param {string} contentType
 * @returns {ContentParser}
 */
export function createContentParser(contentType) {
  const parser = PARSERS[contentType];
  if (!parser) throw new Error(`No parser for content type: "${contentType}"`);
  return parser;
}

/**
 * Detect content type from email message shape.
 * @param {Object} message - normalised email message
 * @returns {string} content type key
 */
export function detectEmailContentType(message) {
  const attachments = message.attachments || [];
  for (const att of attachments) {
    if (att.contentType?.includes('pdf'))  return 'pdf';
    if (att.contentType?.includes('xlsx') ||
        att.filename?.endsWith('.xlsx'))   return 'xlsx';
  }
  return 'plain_text';
}
