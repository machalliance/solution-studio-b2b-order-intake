/**
 * @file xlsx.js
 * @description XLSX content parser using exceljs (MIT).
 *              Uses exceljs - NOT the SheetJS/xlsx package (proprietary from v0.18).
 * @module parsers/xlsx
 */
import ExcelJS from 'exceljs';

export class XLSXParser {
  get supportedTypes() { return ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']; }

  /**
   * @param {Object} message
   * @returns {Promise<{text: string, contentType: string, structured: Object[]}>}
   */
  async parse(message) {
    const content = message.content ||
      (message.attachments || []).find(a =>
        a.filename?.endsWith('.xlsx') || a.contentType?.includes('xlsx')
      )?.content;

    if (!content) throw new Error('XLSX parser: no XLSX content found');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content);
    const worksheet = workbook.worksheets[0];

    const rows = [];
    let headers = [];
    worksheet.eachRow((row, rowNum) => {
      if (rowNum === 1) {
        headers = row.values.slice(1).map(v => String(v || '').trim());
      } else {
        const record = {};
        row.values.slice(1).forEach((v, i) => {
          if (headers[i]) record[headers[i]] = v ?? '';
        });
        rows.push(record);
      }
    });

    const text = rows.map((r, i) =>
      `Row ${i + 1}: ${Object.entries(r).map(([k,v]) => `${k}=${v}`).join(', ')}`
    ).join('\n');

    return { text, contentType: 'xlsx', structured: rows };
  }
}
