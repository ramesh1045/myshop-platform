import { Knex } from 'knex';
import { db } from './knex';
import { currentTenantId } from '../context/request-context';

/**
 * Tenant-scoped query builder — Node.js replacement for Hibernate 6 `@TenantId`.
 *   tq('products').where({ id })            -> ... WHERE products.tenant_id = <current> AND id = ?
 *   tq('orders as o').join(...)             -> alias aware
 * The tenant id always comes from the request context (Host header -> tenant),
 * never from the client payload, so shop A can never read shop B's rows.
 */
export function tq<T extends {} = any>(table: string, trx?: Knex | Knex.Transaction, tenantId?: number) {
  const tid = tenantId ?? currentTenantId();
  const alias = table.includes(' as ') ? table.split(' as ')[1].trim() : table;
  return (trx ?? db)<T>(table).where(`${alias}.tenant_id`, tid);
}

/** Insert row(s) with tenant_id forced from context (any tenant_id in payload is overwritten). */
export async function tinsert(
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
  trx?: Knex | Knex.Transaction,
  tenantId?: number,
): Promise<number> {
  const tid = tenantId ?? currentTenantId();
  const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r, tenant_id: tid }));
  const [id] = await (trx ?? db)(table).insert(list);
  return Number(id);
}

/** Strip fields a client must never be able to change. */
export function safePatch<T extends Record<string, unknown>>(patch: T): T {
  const { tenant_id, id, created_at, ...rest } = patch as any;
  return rest;
}

/** Gap-free per-tenant counter (order numbers). Must be called inside a transaction. */
export async function nextCounter(trx: Knex.Transaction, name: string, tenantId?: number): Promise<number> {
  const tid = tenantId ?? currentTenantId();
  await trx.raw(
    'INSERT INTO tenant_counters (tenant_id, counter_name, value) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE value = value',
    [tid, name],
  );
  const row = await trx('tenant_counters').where({ tenant_id: tid, counter_name: name }).forUpdate().first();
  const next = Number(row.value) + 1;
  await trx('tenant_counters').where({ tenant_id: tid, counter_name: name }).update({ value: next });
  return next;
}
