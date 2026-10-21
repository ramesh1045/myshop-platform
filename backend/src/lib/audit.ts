import type { Knex } from 'knex';
import { db } from '../db/knex';
import { ctx } from '../context/request-context';
import { logger } from './logger';

/** Audit log (PDF §12 phase 2). Records impersonator too (PDF §12 phase 5). */
export async function audit(
  action: string, entityType?: string, entityId?: string | number | null,
  oldValues?: unknown, newValues?: unknown, trx?: Knex.Transaction, tenantIdOverride?: number | null,
) {
  const c = ctx();
  const actorType = c?.auth?.type ?? 'SYSTEM';
  try {
    await (trx ?? db)('audit_logs').insert({
      tenant_id: tenantIdOverride !== undefined ? tenantIdOverride : c?.tenant?.id ?? null,
      actor_type: actorType,
      actor_id: c?.auth?.id ?? null,
      impersonator_id: c?.auth?.impersonatorId ?? null,
      action,
      entity_type: entityType ?? null,
      entity_id: entityId != null ? String(entityId) : null,
      old_values: oldValues ? JSON.stringify(scrub(oldValues)) : null,
      new_values: newValues ? JSON.stringify(scrub(newValues)) : null,
      ip: c?.ip ?? null,
      user_agent: c?.userAgent ?? null,
    });
  } catch (e) {
    logger.error({ err: e }, 'audit write failed');
  }
}

function scrub(v: any): any {
  if (!v || typeof v !== 'object') return v;
  const out: any = Array.isArray(v) ? [] : {};
  for (const [k, val] of Object.entries(v)) {
    if (/password|secret|token|hash/i.test(k)) out[k] = '***';
    else if (Buffer.isBuffer(val)) out[k] = '***';
    else out[k] = val;
  }
  return out;
}
