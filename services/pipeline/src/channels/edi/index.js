/**
 * @file index.js
 * @description EDI channel adapter. Polls the EDI inbox folder every 2 seconds for
 *              new files and hands each one to the LangGraph pipeline via the onMessage
 *              callback. Supports X12 850 (.edi), CSV, and XLSX file formats.
 *
 * Uses filesystem polling rather than fs.watch because fs.watch is unreliable on
 * Docker bind mounts (inotify events may not propagate from host to container).
 *
 * File stability check: stats the file twice with a 500 ms gap to detect files
 * that are still being written (e.g. large transfers). Only processes stable files.
 *
 * After processing, files are moved to EDI_ERROR_PATH using copyFile+unlink rather
 * than rename to avoid EXDEV errors on cross-device bind mounts. Successfully
 * processed files are prefixed 'processed-'; error files keep their original name.
 * @module channels/edi
 */
import { readdir, readFile, copyFile, unlink, mkdir, stat } from 'fs/promises';
import { join, extname } from 'path';
import { config }  from '../../config.js';
import { logger }  from '../../util/logger.js';

/** File extensions accepted by this adapter and their MACH-pipeline contentType codes. */
const SUPPORTED_EXTENSIONS = new Set(['.csv', '.xlsx', '.edi']);

const EXT_TO_CONTENT_TYPE = {
  '.csv':  'csv',
  '.xlsx': 'xlsx',
  '.edi':  'x12_850',  // X12 850 Purchase Order
};

export class EDIChannelAdapter {
  constructor() {
    this.inboxPath   = config.EDI_INBOX_PATH;
    this.errorPath   = config.EDI_ERROR_PATH;
    this.name        = 'edi';
    this._running    = false;
    this._processing = new Set();  // files currently being processed (prevents double-dispatch)
    this._seen       = new Set();  // filenames already processed in this session
  }

  /**
   * Start polling the inbox folder.
   * @param {Function} onMessage - async callback receiving a normalised channel message object
   */
  async start(onMessage) {
    this._onMessage = onMessage;
    this._running   = true;
    // Ensure both directories exist before polling starts
    await mkdir(this.inboxPath, { recursive: true });
    await mkdir(this.errorPath, { recursive: true });
    logger.info({ inboxPath: this.inboxPath, intervalMs: config.EDI_POLL_INTERVAL_MS }, 'EDI channel: polling started');
    this._pollLoop();
  }

  /** Stop the poll loop. In-flight file processing continues until completion. */
  async stop() {
    this._running = false;
  }

  /** Schedule the next scan tick. Errors in _scanInbox do not stop the loop. */
  _pollLoop() {
    if (!this._running) return;
    setTimeout(async () => {
      try {
        await this._scanInbox();
      } catch (err) {
        logger.error({ err }, 'EDI poll error');
      } finally {
        this._pollLoop();
      }
    }, config.EDI_POLL_INTERVAL_MS);
  }

  /**
   * Scan the inbox for new stable files and dispatch each one for processing.
   * Files in _processing or _seen are skipped; dotfiles (e.g. .gitkeep) are skipped.
   */
  async _scanInbox() {
    let files;
    try {
      files = await readdir(this.inboxPath);
    } catch {
      return; // inbox directory not mounted yet - will retry on next tick
    }

    for (const filename of files) {
      if (filename.startsWith('.')) continue;  // skip .gitkeep, .DS_Store, etc.
      const ext = extname(filename).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      if (this._processing.has(filename)) continue;
      if (this._seen.has(filename)) continue;

      // Stability check: file size and mtime must be unchanged after 500 ms
      const filePath = join(this.inboxPath, filename);
      try {
        const s1 = await stat(filePath);
        await new Promise(r => setTimeout(r, 500));
        const s2 = await stat(filePath);
        if (s1.size !== s2.size || s1.mtimeMs !== s2.mtimeMs) continue; // still being written
      } catch {
        continue; // file disappeared between readdir and stat (race condition) - skip
      }

      // Mark in-progress BEFORE the async dispatch to prevent double-processing
      this._processing.add(filename);
      this._seen.add(filename);
      logger.info({ filename }, 'EDI channel: file detected');
      // Fire-and-forget - _scanInbox does not await individual file processing
      this._processFile(filename, ext, filePath);
    }
  }

  /**
   * Read, dispatch, and archive a single file.
   * On success: copied to errorPath as 'processed-<filename>' then deleted from inbox.
   * On error: copied to errorPath under the original filename then deleted from inbox.
   * copyFile+unlink is used instead of rename to avoid EXDEV on Docker bind mounts.
   * @param {string} filename
   * @param {string} ext
   * @param {string} filePath
   */
  async _processFile(filename, ext, filePath) {
    try {
      const content = await readFile(filePath);
      logger.info({ filename, bytes: content.length }, 'EDI channel: processing file');

      const message = {
        channel:     'edi',
        contentType: EXT_TO_CONTENT_TYPE[ext],
        filename,
        content,
        channelMetadata: { filename, ext, inboxPath: this.inboxPath, filePath },
      };

      await Promise.race([
        this._onMessage(message),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Graph timeout after ${config.GRAPH_TIMEOUT_MS}ms`)), config.GRAPH_TIMEOUT_MS)
        ),
      ]);

      // Archive processed file so it cannot be picked up again on the next restart
      try {
        await copyFile(filePath, join(this.errorPath, `processed-${filename}`));
        await unlink(filePath);
        logger.info({ filename }, 'EDI channel: file processed and archived');
      } catch (moveErr) {
        logger.error({ err: moveErr, filename }, 'EDI channel: could not archive file');
      }
    } catch (err) {
      logger.error({ err, filename }, 'EDI channel: file processing error');
      // Move failed files to errorPath without 'processed-' prefix for easy identification
      try {
        await copyFile(filePath, join(this.errorPath, filename));
        await unlink(filePath);
      } catch { /* ignore - file may have been deleted externally */ }
    } finally {
      this._processing.delete(filename);
    }
  }
}
