/**
 * Custom domain verification (PDF §2): client adds a CNAME -> system verifies ->
 * Caddy issues the SSL certificate automatically via on-demand TLS (it asks /api/internal/domain-check).
 */
import { promises as dns } from 'node:dns';
import { db } from '../db/knex';
import { env } from '../config/env';
import { invalidate, keys } from '../cache/cache';
import { invalidateTenant } from './billing.service';
import { sendEmail } from '../lib/queue';
import { logger } from '../lib/logger';

const MAX_ATTEMPTS = 432; // 72 h at one check every 10 min

export async function checkDomainNow(domainId: number) {
  const d = await db('tenant_domains').where({ id: domainId }).first();
  if (!d || d.type !== 'CUSTOM') return { status: 'UNKNOWN' };
  if (d.verification_status === 'VERIFIED') return { status: 'VERIFIED' };
  let ok = false;
  let error: string | null = null;
  const target = (d.cname_target || env.CNAME_TARGET).toLowerCase().replace(/\.$/, '');
  try {
    const cn = await dns.resolveCname(d.domain).catch(() => [] as string[]);
    if (cn.some((c) => c.toLowerCase().replace(/\.$/, '') === target)) ok = true;
    if (!ok && env.SERVER_IP) {
      const a = await dns.resolve4(d.domain).catch(() => [] as string[]);
      if (a.includes(env.SERVER_IP)) ok = true;
    }
    if (!ok) error = `CNAME for ${d.domain} does not point to ${target} yet`;
  } catch (e: any) {
    error = e.message;
  }
  const attempts = d.check_attempts + 1;
  const status = ok ? 'VERIFIED' : attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
  await db('tenant_domains').where({ id: d.id }).update({
    verification_status: status, last_checked_at: new Date(), last_check_error: ok ? null : error,
    check_attempts: attempts, verified_at: ok ? new Date() : null,
  });
  if (ok) {
    await invalidate(keys.domain(d.domain));
    await invalidateTenant(Number(d.tenant_id));
    const t = await db('tenants').where({ id: d.tenant_id }).first('owner_email', 'name');
    await sendEmail({ tenantId: Number(d.tenant_id), to: t.owner_email, template: 'domain_verified',
      subject: `${d.domain} is connected`, payload: { domain: d.domain, storeName: t.name } });
    logger.info({ domain: d.domain }, 'custom domain verified');
  }
  return { status, error };
}

export async function checkPendingDomains() {
  const pending = await db('tenant_domains').where({ type: 'CUSTOM', verification_status: 'PENDING' }).pluck('id');
  for (const id of pending) await checkDomainNow(Number(id)).catch((e) => logger.error(e));
  return pending.length;
}

/** Caddy on-demand TLS "ask": only issue certificates for hosts we actually serve */
export async function isServedDomain(domain: string): Promise<boolean> {
  const host = domain.toLowerCase();
  const root = env.PLATFORM_DOMAIN.toLowerCase();
  if (host === root || host === `www.${root}` || host === `admin.${root}`) return true;
  const row = await db('tenant_domains as d').join('tenants as t', 't.id', 'd.tenant_id')
    .where('d.domain', host).where('d.verification_status', 'VERIFIED').whereNot('t.status', 'CANCELLED').first('d.id');
  return !!row;
}
