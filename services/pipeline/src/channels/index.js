/**
 * @file index.js
 * @description Channel bootstrap. Instantiates and starts all inbound channel adapters
 *              configured via the CHANNEL_ADAPTERS env var. Each adapter runs its own
 *              delivery loop (poll or webhook) and calls graph.invoke() for every message.
 *
 * Active channels are controlled by CHANNEL_ADAPTERS (default: 'email,edi').
 * To disable a channel, remove it from the comma-separated list.
 *
 * Webhook-based adapters (e.g. SendGrid Inbound Parse) expose a `.router` property
 * (Express Router). The caller (index.js) is responsible for mounting these routers
 * on the Express app before calling app.listen().
 * @module channels
 */
import { createEmailChannel } from './email/index.js';
import { EDIChannelAdapter }  from './edi/index.js';
import { logger }             from '../util/logger.js';

/** Maps channel name -> factory function. Add new channels here. */
const CHANNEL_FACTORIES = {
  email: () => createEmailChannel(),
  edi:   () => new EDIChannelAdapter(),
};

/**
 * Start all configured inbound channel adapters. Each adapter receives a callback
 * that invokes the LangGraph pipeline for every inbound message.
 *
 * @param {import('@langchain/langgraph').CompiledStateGraph} graph - compiled order processing graph
 * @param {Object} adapters - pipeline adapters
 * @returns {Promise<Object[]>} started channel adapter instances
 *   Instances may include a `.router` property (Express Router) for webhook-based channels.
 *   Mount these at /api/v1 before app.listen() - see index.js.
 * @throws {Error} if an unknown channel name is configured
 */
export async function startChannels(graph, adapters) {
  const configured = (process.env.CHANNEL_ADAPTERS || 'email,edi')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const instances = [];
  for (const name of configured) {
    const factory = CHANNEL_FACTORIES[name];
    if (!factory) throw new Error(`Unknown channel adapter: "${name}". Valid values: ${Object.keys(CHANNEL_FACTORIES).join(', ')}`);
    const adapter = factory();

    // Each channel adapter gets a dedicated graph.invoke() callback.
    // A UUID is generated here and used as BOTH the LangGraph thread_id AND the
    // orderId passed into state, so the checkpointer key and the DB primary key
    // are always the same value. This lets graph.invoke(null, { thread_id: orderId })
    // resume the correct graph state when an operator actions a review item.
    await adapter.start(async (rawMessage) => {
      const threadId = crypto.randomUUID();
      try {
        await graph.invoke(
          { ...rawMessage, orderId: threadId },
          { configurable: { thread_id: threadId } }
        );
      } catch (err) {
        logger.error({ err, channel: name, threadId }, 'Graph error processing message');
      }
    });

    instances.push(adapter);
    logger.info({ channel: name, provider: adapter.name }, 'Channel started');
  }
  return instances;
}
