/**
 * Two-level cache — PDF §8 / §11 "Redis + Caffeine".
 *   L1: in-process LRU (lru-cache)  ≈ Caffeine
 *   L2: Redis (shared by all API instances)
 * Invalidation is broadcast over Redis pub/sub so every API instance drops its L1 copy
 * (keeps the API stateless & horizontally scalable — PDF §7).
 * Cached: domain lookup, theme/storefront config, menus, permissions, modules, limits.
 */
import Redis from 'ioredis';
import { LRUCache } from 'lru-cache';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
const sub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
redis.on('error', (e) => logger.error({ err: e }, 'redis error'));
sub.on('error', (e) => logger.error({ err: e }, 'redis sub error'));

const l1 = new LRUCache<string, { v: unknown }>({ max: 20_000, ttl: 60_000 });
const CHANNEL = 'cache:invalidate';

sub.subscribe(CHANNEL).catch((e) => logger.error(e));
sub.on('message', (_ch, msg) => {
  const { prefix } = JSON.parse(msg) as { prefix: string };
  for (const k of l1.keys()) if (k.startsWith(prefix)) l1.delete(k);
});

export interface CacheOpts { ttlSec?: number; l1TtlMs?: number }

export async function cached<T>(key: string, loader: () => Promise<T>, opts: CacheOpts = {}): Promise<T> {
  const ttlSec = opts.ttlSec ?? 300;
  const hit = l1.get(key);
  if (hit) return hit.v as T;
  try {
    const raw = await redis.get(key);
    if (raw !== null) {
      const v = JSON.parse(raw) as T;
      l1.set(key, { v }, { ttl: opts.l1TtlMs ?? Math.min(ttlSec * 1000, 30_000) });
      return v;
    }
  } catch (e) {
    logger.warn({ err: e }, 'redis get failed, falling back to DB');
  }
  const v = await loader();
  l1.set(key, { v }, { ttl: opts.l1TtlMs ?? Math.min(ttlSec * 1000, 30_000) });
  redis.set(key, JSON.stringify(v ?? null), 'EX', ttlSec).catch(() => undefined);
  return v;
}

/** Delete every key that starts with prefix in L1 (all instances) and L2. */
export async function invalidate(prefix: string): Promise<void> {
  for (const k of l1.keys()) if (k.startsWith(prefix)) l1.delete(k);
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
    await redis.publish(CHANNEL, JSON.stringify({ prefix }));
  } catch (e) {
    logger.warn({ err: e }, 'cache invalidate failed');
  }
}

/** Cache key helpers — every tenant key starts with t:<id>: so one call clears a whole shop */
export const keys = {
  domain: (host: string) => `dom:${host}`,
  tenant: (id: number) => `t:${id}:`,
  storefront: (id: number) => `t:${id}:sf`,
  modules: (id: number) => `t:${id}:mods`,
  limits: (id: number) => `t:${id}:limits`,
  perms: (id: number, userId: number) => `t:${id}:acl:perm:${userId}`,
  menus: (id: number, userId: number) => `t:${id}:acl:menu:${userId}`,
  acl: (id: number) => `t:${id}:acl:`,
};

export async function closeCache() {
  await Promise.allSettled([redis.quit(), sub.quit()]);
}
