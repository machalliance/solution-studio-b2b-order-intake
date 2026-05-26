/**
 * @file index.js
 * @description Pipeline service entry point. Runs migrations, starts channels,
 *              initialises the LangGraph graph, and starts the Express API.
 *
 * Boot sequence:
 *   1. Run DB migrations (idempotent - safe on every restart)
 *   2. Instantiate all adapters (ERP, notification, customer, logging, extraction, SKU)
 *   3. Compile the LangGraph order-processing graph
 *   4. Start inbound channel adapters (email poll loop + EDI folder watch)
 *   5. Mount the API router and begin serving HTTP
 *
 * All configuration is via environment variables - no hardcoded values (Cloud-native / MACH-C).
 * @module pipeline
 */
import 'dotenv/config';
import express     from 'express';
import rateLimit   from 'express-rate-limit';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { logger }  from './util/logger.js';
import { config }  from './config.js';
import { runMigrations }               from './db/migrate.js';
import { buildOrderGraph }             from './graph/index.js';
import { createERPAdapter }            from './adapters/erp/index.js';
import { createNotificationAdapter }   from './adapters/notification/index.js';
import { createCustomerLookupAdapter } from './adapters/customer/index.js';
import { createLoggingAdapter }        from './adapters/logging/index.js';
import { createExtractionProvider }    from './extraction/index.js';
import { createSkuResolver }           from './sku/index.js';
import { createEdiOutboundAdapter }   from './adapters/edi-outbound/index.js';
import { startChannels }               from './channels/index.js';
import { createApiRouter }             from './api/routes.js';

const PORT = process.env.PIPELINE_PORT || 3002;

/**
 * Application bootstrap. Runs once at process start.
 * All top-level async work lives here so errors are caught centrally.
 * @returns {Promise<void>}
 */
async function main() {
  logger.info('B2B Order Intake Pipeline starting...');

  // Migrations run synchronously before any traffic - guarantees schema is up to date
  await runMigrations();

  // Initialise the LangGraph PostgreSQL checkpointer.
  // setup() is idempotent - creates checkpoint tables if they don't exist.
  // The checkpointer serialises full graph state when interruptBefore:['review'] fires,
  // allowing graph.invoke(null, { thread_id }) to resume after an operator action.
  const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL);
  await checkpointer.setup();

  // Adapters are the boundary between the pipeline and all external systems.
  // Each factory reads its own env vars so the graph itself stays decoupled.
  const adapters = {
    erp:         createERPAdapter(),
    notification: createNotificationAdapter(),
    customer:    createCustomerLookupAdapter(),
    logging:     createLoggingAdapter(),
    extraction:  createExtractionProvider(),
    sku:         createSkuResolver(),
    ediOutbound: createEdiOutboundAdapter(),
  };

  // Compile the LangGraph state machine with the Postgres checkpointer.
  const graph = buildOrderGraph(adapters, checkpointer);

  const app = express();
  app.use(express.json());

  // Global rate limit - 100 requests per minute per IP across all /api/v1 routes.
  // Prevents runaway clients from exhausting DB connections or Claude API quota.
  const globalLimiter = rateLimit({
    windowMs:        60 * 1000,
    max:             () => config.API_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { error: 'Too many requests - please wait before retrying' },
  });
  app.use('/api/v1', globalLimiter);

  // Shallow health check - no DB hit. Used by Docker/K8s liveness probes.
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'pipeline' }));

  // Channel adapters must start before the API so the graph reference is ready
  const channels = await startChannels(graph, adapters);

  // Webhook-based channel adapters (e.g. SendGrid Inbound Parse) expose a `.router`
  // property. Mount them before the main API router so they inherit the rate limiter.
  for (const ch of channels) {
    if (ch.router) app.use('/api/v1', ch.router);
  }

  // The Agent Control Interface (UI) is the sole consumer of these endpoints (MACH headless)
  app.use('/api/v1', createApiRouter(adapters, graph, channels));

  app.listen(PORT, () => logger.info({ port: PORT }, 'Pipeline API running'));

  logger.info('Pipeline ready - processing orders.');
}

main().catch(err => {
  logger.fatal({ err }, 'Fatal pipeline error');
  process.exit(1);
});
