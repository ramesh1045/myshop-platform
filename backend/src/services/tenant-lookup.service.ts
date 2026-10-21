import { db } from '../db/knex';
import { cached, keys } from '../cache/cache';
import { env } from '../config/env';
import type { AppSurface, TenantInfo } from '../context/request-context';

export function normalizeHost(raw: string | undefined): string {
  return (raw || '').toLowerCase().trim().replace(/:\d+$/, '').replace(/\.$/, '');
}

export function surfaceForHost(host: string): AppSurface | null {
  const root = env.PLATFORM_DOMAIN.toLowerCase();
  if (host === root || host === `www.${root}`) return 'MARKETING';
  if (host === `admin.${root}`) return 'PLATFORM_ADMIN';
  return null; // a store (subdomain or custom domain)
}

/** Host header -> tenant (PDF §6 TenantFilter). Cached in Redis + L1 (PDF §8). */
export async function findTenantByHost(host: string): Promise<TenantInfo | null> {
  return cached(keys.domain(host), async () => {
    const row = await db('tenant_domains as d')
      .join('tenants as t', 't.id', 'd.tenant_id')
      .where('d.domain', host)
      .where('d.verification_status', 'VERIFIED')
      .select('t.id', 't.uuid', 't.name', 't.subdomain', 't.status', 't.plan_id', 't.currency')
      .first();
    if (!row) return null;
    const primary = await db('tenant_domains')
      .where({ tenant_id: row.id, verification_status: 'VERIFIED' })
      .orderBy([{ column: 'is_primary', order: 'desc' }, { column: 'type', order: 'asc' }])
      .first();
    return {
      id: Number(row.id), uuid: row.uuid, name: row.name, subdomain: row.subdomain, status: row.status,
      planId: Number(row.plan_id), currency: row.currency, primaryDomain: primary?.domain ?? host,
    } satisfies TenantInfo;
  }, { ttlSec: 300 });
}

export async function findTenantById(id: number): Promise<TenantInfo | null> {
  const d = await db('tenant_domains').where({ tenant_id: id, type: 'SUBDOMAIN' }).first();
  return d ? findTenantByHost(d.domain) : null;
}
