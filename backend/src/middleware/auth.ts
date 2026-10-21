import type { NextFunction, Request, Response } from 'express';
import { ctx } from '../context/request-context';
import { verifyAccess } from '../lib/jwt';
import { HttpError, forbidden } from '../lib/http-error';
import { enabledModules, userPermissions } from '../services/access.service';
import { db } from '../db/knex';
import { cached } from '../cache/cache';
import { sha256 } from '../lib/crypto';
import { findTenantById } from '../services/tenant-lookup.service';

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return null;
}

/**
 * JwtFilter (PDF §6): verifies the token and enforces
 *   token.tid === tenant resolved from the Host header.
 * If they differ the request is rejected, so a user of shop A can never see shop B's data.
 */
export const requireAuth = (type: 'PLATFORM' | 'USER' | 'CUSTOMER') =>
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) return next(new HttpError(401, 'UNAUTHENTICATED', 'Login required'));
    let claims;
    try {
      claims = verifyAccess(token);
    } catch {
      return next(new HttpError(401, 'TOKEN_INVALID', 'Session expired, please login again'));
    }
    if (claims.typ !== type) return next(new HttpError(401, 'TOKEN_TYPE', 'Wrong token type'));
    const c = ctx()!;

    if (type === 'PLATFORM') {
      if (c.surface !== 'PLATFORM_ADMIN') return next(forbidden('Super admin token only valid on admin domain'));
      const u = await db('platform_users').where({ id: Number(claims.sub), is_active: 1 }).first('id');
      if (!u) return next(new HttpError(401, 'USER_DISABLED', 'Account disabled'));
    } else {
      if (!c.tenant) return next(forbidden('Store token used outside a store domain'));
      if (Number(claims.tid) !== c.tenant.id) {
        return next(new HttpError(403, 'TENANT_MISMATCH', 'Token does not belong to this store'));
      }
      if (type === 'USER') {
        const u = await cached(`t:${c.tenant.id}:acl:user:${claims.sub}`, () =>
          db('users').where({ tenant_id: c.tenant!.id, id: Number(claims.sub) }).first('status', 'is_owner'),
        { ttlSec: 60, l1TtlMs: 10_000 });
        if (!u || u.status !== 'ACTIVE') return next(new HttpError(401, 'USER_DISABLED', 'Account disabled'));
      }
    }
    c.auth = {
      type, id: Number(claims.sub), tenantId: claims.tid, isOwner: !!claims.own, impersonatorId: claims.imp,
    };
    next();
  };

/** Optional customer auth (checkout works for guests too) */
export const optionalCustomer = async (req: Request, res: Response, next: NextFunction) => {
  if (!bearer(req)) return next();
  return requireAuth('CUSTOMER')(req, res, next);
};

/**
 * Permission check — Node.js equivalent of
 *   @PreAuthorize("hasAuthority('ORDER_VIEW')")
 * Role NAME never matters, only permission CODE (PDF §5.1) — new roles need no code change.
 */
export const requirePermission = (...codes: string[]) =>
  async (_req: Request, _res: Response, next: NextFunction) => {
    const c = ctx()!;
    if (!c.auth || c.auth.type !== 'USER' || !c.tenant) return next(new HttpError(401, 'UNAUTHENTICATED', 'Login required'));
    const perms = await userPermissions(c.tenant.id, c.auth.id, !!c.auth.isOwner);
    if (!codes.some((code) => perms.includes(code))) return next(forbidden(`Missing permission: ${codes.join(' or ')}`));
    next();
  };

/** Module gate — feature only when module is ON for this tenant (PDF §9 tenant_modules) */
export const requireModule = (code: string) =>
  async (_req: Request, _res: Response, next: NextFunction) => {
    const t = ctx()?.tenant;
    if (!t) return next(forbidden());
    const mods = await enabledModules(t.id);
    if (!mods.includes(code)) {
      return next(new HttpError(402, 'MODULE_DISABLED', `The ${code} module is not enabled for your store. Upgrade your plan or buy the add-on.`));
    }
    next();
  };

/**
 * Store suspended for non-payment (PDF §3 step 9): admin can still log in and pay,
 * but every other admin write is blocked.
 */
export const blockIfSuspended = (req: Request, _res: Response, next: NextFunction) => {
  const t = ctx()?.tenant;
  if (!t) return next();
  const allowed = ['/billing', '/auth', '/me'];
  if ((t.status === 'SUSPENDED' || t.status === 'CANCELLED' || t.status === 'PENDING_PAYMENT') && req.method !== 'GET'
      && !allowed.some((p) => req.path.startsWith(p))) {
    return next(new HttpError(423, 'STORE_SUSPENDED', 'Your store is suspended. Please pay the pending invoice to continue.'));
  }
  next();
};

/** Headless API key auth (PDF §9 "headless API (API key)") — tenant comes from the key, not the host */
export const requireApiKey = async (req: Request, _res: Response, next: NextFunction) => {
  const key = String(req.headers['x-api-key'] || '');
  if (!key) return next(new HttpError(401, 'API_KEY_REQUIRED', 'X-API-Key header required'));
  const row = await db('api_keys').comment('global').where({ key_hash: sha256(key) }).whereNull('revoked_at').first();
  if (!row) return next(new HttpError(401, 'API_KEY_INVALID', 'Invalid API key'));
  const tenant = await findTenantById(Number(row.tenant_id));
  if (!tenant || !['ACTIVE', 'TRIAL'].includes(tenant.status)) return next(new HttpError(423, 'STORE_SUSPENDED', 'Store not active'));
  const mods = await enabledModules(tenant.id);
  if (!mods.includes('HEADLESS_API')) return next(new HttpError(402, 'MODULE_DISABLED', 'Headless API not in plan'));
  const c = ctx()!;
  c.tenant = tenant;
  c.auth = { type: 'API_KEY', id: Number(row.id), tenantId: tenant.id, apiKeyId: Number(row.id) };
  (req as any).apiScopes = row.scopes as string[];
  db('api_keys').where({ tenant_id: row.tenant_id, id: row.id }).update({ last_used_at: new Date() }).catch(() => undefined);
  next();
};
