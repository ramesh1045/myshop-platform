import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpError } from '../lib/http-error';

/** Which of the 4 surfaces this request is for (PDF §2 domain table) */
export type AppSurface = 'MARKETING' | 'PLATFORM_ADMIN' | 'STORE' | 'HEADLESS' | 'INTERNAL';

export interface TenantInfo {
  id: number;
  uuid: string;
  name: string;
  subdomain: string;
  status: 'PENDING_PAYMENT' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';
  planId: number;
  currency: string;
  primaryDomain: string;
}

export interface AuthInfo {
  type: 'PLATFORM' | 'USER' | 'CUSTOMER' | 'API_KEY';
  id: number;
  tenantId?: number;
  isOwner?: boolean;
  impersonatorId?: number;
  apiKeyId?: number;
}

export interface RequestContext {
  surface: AppSurface;
  host: string;
  tenant?: TenantInfo;
  auth?: AuthInfo;
  ip?: string;
  userAgent?: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T => als.run(ctx, fn);
export const ctx = (): RequestContext | undefined => als.getStore();

/** Equivalent of Hibernate's current tenant identifier resolver. */
export function currentTenantId(): number {
  const id = als.getStore()?.tenant?.id;
  if (!id) throw new HttpError(400, 'TENANT_REQUIRED', 'No tenant for this request');
  return id;
}
export function currentTenant(): TenantInfo {
  const t = als.getStore()?.tenant;
  if (!t) throw new HttpError(400, 'TENANT_REQUIRED', 'No tenant for this request');
  return t;
}
export function currentAuth(): AuthInfo {
  const a = als.getStore()?.auth;
  if (!a) throw new HttpError(401, 'UNAUTHENTICATED', 'Login required');
  return a;
}
