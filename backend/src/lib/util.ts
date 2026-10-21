import type { Knex } from 'knex';

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9஀-௿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150) || 'item';
}

/** Unique slug within a tenant table */
export async function uniqueSlug(trx: Knex | Knex.Transaction, table: string, tenantId: number, base: string, exceptId?: number) {
  const root = slugify(base);
  let slug = root;
  for (let i = 2; ; i++) {
    const q = trx(table).where({ tenant_id: tenantId, slug });
    if (exceptId) q.whereNot('id', exceptId);
    if (!(await q.first('id'))) return slug;
    slug = `${root}-${i}`;
  }
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
export const DOMAIN_RE = /^(?=.{4,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;

export function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);

/** Run fn only after the transaction has COMMITTED (emails, cache invalidation). */
export function afterCommit(trx: Knex.Transaction, fn: () => unknown) {
  const ep: Promise<unknown> | undefined = (trx as any).executionPromise;
  const run = () => { Promise.resolve().then(fn).catch((e) => console.error('afterCommit task failed', e)); };
  if (ep) ep.then(run, () => undefined);
  else setTimeout(run, 500);
}
