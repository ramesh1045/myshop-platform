import type { NextFunction, Request, Response } from 'express';
import { ctx, runWithContext, RequestContext } from '../context/request-context';
import { findTenantByHost, normalizeHost, surfaceForHost } from '../services/tenant-lookup.service';
import { HttpError } from '../lib/http-error';

/**
 * TenantFilter (PDF §6): Host header -> tenant_id.
 * kavya.myshop.com / kavyatextiles.com -> tenant; myshop.com -> marketing; admin.myshop.com -> super admin.
 * Everything downstream runs inside an AsyncLocalStorage context holding the tenant.
 */
export async function tenantFilter(req: Request, res: Response, next: NextFunction) {
  const host = normalizeHost(req.hostname || req.headers.host);
  const base: RequestContext = {
    surface: 'MARKETING', host, ip: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 255),
  };

  // Internal & headless endpoints resolve tenant differently
  if (req.path.startsWith('/api/internal/')) return runWithContext({ ...base, surface: 'INTERNAL' }, next);
  if (req.path.startsWith('/api/headless/')) return runWithContext({ ...base, surface: 'HEADLESS' }, next);
  if (req.path === '/api/health') return runWithContext(base, next);

  const surface = surfaceForHost(host);
  if (surface) return runWithContext({ ...base, surface }, next);

  const tenant = await findTenantByHost(host);
  if (!tenant) return next(new HttpError(404, 'STORE_NOT_FOUND', `No store is configured for ${host}`));
  return runWithContext({ ...base, surface: 'STORE', tenant }, next);
}

/** Restrict a router to one surface (e.g. /api/platform only on admin.myshop.com) */
export const onlySurface = (...allowed: RequestContext['surface'][]) =>
  (_req: Request, _res: Response, next: NextFunction) => {
    const c = ctx();
    if (!c || !allowed.includes(c.surface)) {
      return next(new HttpError(404, 'NOT_FOUND', 'Endpoint not available on this domain'));
    }
    next();
  };
