/**
 * @file logger.js
 * @description Structured JSON logger for the pipeline service.
 *              All pipeline code imports this module and uses logger.info/warn/error
 *              instead of console.log - output is newline-delimited JSON compatible
 *              with any cloud log aggregator (Datadog, CloudWatch, GCP Logging, etc.).
 *
 * Log levels (set via LOG_LEVEL env var, default 'info'):
 *   trace | debug | info | warn | error | fatal
 *
 * To pretty-print in development:
 *   docker logs b2b-order-intake-pipeline-1 | npx pino-pretty
 *
 * Graph nodes should use child loggers to include orderId in every line:
 *   const log = logger.child({ orderId: state.orderId });
 *   log.error({ err }, 'Node failed');
 * @module util/logger
 */
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base:  { service: 'pipeline' },
});
