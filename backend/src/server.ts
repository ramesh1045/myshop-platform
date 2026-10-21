import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { db } from './db/knex';
import { closeCache } from './cache/cache';

/**
 * Stateless API process (JWT + Redis + object storage) — run 1..N copies behind the
 * load balancer (PDF §7 horizontal scaling).
 */
const server = createApp().listen(env.PORT, () => logger.info(`API listening on :${env.PORT} (platform domain: ${env.PLATFORM_DOMAIN})`));

async function shutdown(sig: string) {
  logger.info(`${sig} received, shutting down`);
  server.close(async () => {
    await Promise.allSettled([db.destroy(), closeCache()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (e) => logger.error({ err: e }, 'unhandledRejection'));
