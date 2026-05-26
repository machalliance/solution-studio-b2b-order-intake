/**
 * @file retry.js
 * @description Exponential-backoff retry wrapper for transient external calls.
 *              Used to make Claude API calls resilient to rate limits, timeouts,
 *              and momentary service interruptions without routing real orders to
 *              human review due to recoverable failures.
 * @module util/retry
 */

/**
 * Execute an async function with exponential-backoff retry on failure.
 * Delays: 1 s -> 2 s -> 4 s -> ... (baseDelayMs x 2^(attempt-1))
 *
 * @template T
 * @param {() => Promise<T>} fn              - async function to attempt
 * @param {Object}  [opts]
 * @param {number}  [opts.maxAttempts=3]     - total attempts before re-throwing
 * @param {number}  [opts.baseDelayMs=1000]  - delay before second attempt (ms)
 * @param {string}  [opts.label='operation'] - name shown in retry warning logs
 * @returns {Promise<T>}
 * @throws the last error if all attempts are exhausted
 */
import { logger } from './logger.js';

export async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 1000, label = 'operation' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn({ err, label, attempt, maxAttempts, delayMs: delay }, 'Retrying after failure');
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}
