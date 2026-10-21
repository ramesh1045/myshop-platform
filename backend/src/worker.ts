/**
 * Worker process (PDF §6): emails, DNS checks for custom domains, subscription renewals.
 * Runs separately from the API so the API stays fast and stateless.
 */
import { Worker } from 'bullmq';
import { env } from './config/env';
import { logger } from './lib/logger';
import { scheduledQueue } from './lib/queue';
import { processEmail } from './jobs/email.job';
import { runRenewals } from './jobs/renewal.job';
import { checkDomainNow, checkPendingDomains } from './services/domain.service';
import { db } from './db/knex';
import { closeCache } from './cache/cache';

const connection = { url: env.REDIS_URL } as any;

const emailWorker = new Worker('notifications', async (job) => processEmail(job.data.notificationId), { connection, concurrency: 10 });

const scheduledWorker = new Worker('scheduled', async (job) => {
  switch (job.name) {
    case 'renewals': return runRenewals();
    case 'dns-check': return checkPendingDomains();
    case 'dns-check-one': return checkDomainNow(job.data.domainId);
    case 'cleanup':
      await db('refresh_tokens').where('expires_at', '<', new Date(Date.now() - 7 * 86400_000)).delete();
      await db('password_resets').where('expires_at', '<', new Date(Date.now() - 86400_000)).delete();
      return 'ok';
    default: return null;
  }
}, { connection, concurrency: 2 });

async function registerSchedules() {
  // repeatable jobs are de-duplicated by BullMQ, safe to call from several workers
  await scheduledQueue.upsertJobScheduler('renewals-daily', { pattern: '30 2 * * *', tz: 'Asia/Kolkata' }, { name: 'renewals' });
  await scheduledQueue.upsertJobScheduler('dns-check-10min', { every: 10 * 60 * 1000 }, { name: 'dns-check' });
  await scheduledQueue.upsertJobScheduler('cleanup-daily', { pattern: '0 4 * * *', tz: 'Asia/Kolkata' }, { name: 'cleanup' });
}

for (const w of [emailWorker, scheduledWorker]) {
  w.on('failed', (job, err) => logger.error({ job: job?.name, err: err.message }, 'job failed'));
}

registerSchedules().then(() => logger.info('Worker started: notifications, renewals, dns checks'));

async function shutdown() {
  await Promise.allSettled([emailWorker.close(), scheduledWorker.close()]);
  await Promise.allSettled([db.destroy(), closeCache()]);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => logger.error({ err: e }, 'unhandledRejection'));
