/**
 * @file text.js
 * @description Plain text content parser - passes email body directly to extraction.
 * @module parsers/text
 */
export class TextParser {
  get supportedTypes() { return ['text/plain']; }

  /**
   * @param {Object} message - normalised message from channel
   * @returns {Promise<{text: string, contentType: string}>}
   */
  async parse(message) {
    return {
      text: message.body || message.html || '',
      contentType: 'plain_text',
    };
  }
}
