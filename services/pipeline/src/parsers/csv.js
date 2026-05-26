/**
 * @file csv.js
 * @description CSV content parser - maps rows to standard internal order format.
 * @module parsers/csv
 */
import { parse } from 'csv-parse/sync';

export class CSVParser {
  get supportedTypes() { return ['.csv', 'text/csv']; }

  /**
   * @param {Object} message
   * @returns {Promise<{text: string, contentType: string, structured: Object[]}>}
   */
  async parse(message) {
    const raw = message.content?.toString('utf8') || message.body || '';
    const records = parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    // Convert to text representation for Claude extraction
    const text = records.map((r, i) =>
      `Row ${i + 1}: ${Object.entries(r).map(([k,v]) => `${k}=${v}`).join(', ')}`
    ).join('\n');

    return { text, contentType: 'csv', structured: records };
  }
}
