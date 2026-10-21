/**
 * Background work goes to the Worker process (PDF §6: emails, DNS checks, renewals)
 * through BullMQ queues on Redis.
 */
import { Queue } from 'bullmq';
import { env } from '../config/env';
import { db } from '../db/knex';
import { logger } from './logger';

const connection = { url: env.REDIS_URL } as any;

export const notificationQueue = new Queue('notifications', { connection });
export const scheduledQueue = new Queue('scheduled', { connection });

export interface EmailJob {
  notificationId: number;
}

/** Record + enqueue an email. Template rendered by worker. */
export async function sendEmail(opts: {
  tenantId: number | null; to: string; template: string; subject: string;
  payload?: Record<string, unknown>; recipientType?: 'PLATFORM' | 'USER' | 'CUSTOMER' | 'EMAIL'; recipientId?: number;
}) {
  try {
    const [id] = await db('notifications').insert({
      tenant_id: opts.tenantId, channel: 'EMAIL', recipient_type: opts.recipientType ?? 'EMAIL',
      recipient_id: opts.recipientId ?? null, recipient: opts.to, template: opts.template,
      subject: opts.subject, payload: JSON.stringify(opts.payload ?? {}),
    });
    await notificationQueue.add('email', { notificationId: Number(id) } satisfies EmailJob, {
      attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000,
    });
  } catch (e) {
    logger.error({ err: e }, 'failed to enqueue email');
  }
}

export async function enqueueDomainCheck(domainId: number) {
  await scheduledQueue.add('dns-check-one', { domainId }, { removeOnComplete: true, attempts: 1 });
}
