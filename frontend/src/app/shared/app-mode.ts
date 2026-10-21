import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { environment } from '../../environments/environment';

/**
 * PDF §2 / §6: ONE Angular build serves every domain.
 *   myshop.com        -> marketing (your website: features, plans, signup)
 *   admin.myshop.com  -> super admin panel
 *   kavya.myshop.com  -> storefront  (+ /admin = store admin panel)
 *   kavyatextiles.com -> storefront of the same client (custom domain)
 */
export type AppMode = 'marketing' | 'superadmin' | 'store';

export function detectMode(hostname = window.location.hostname): AppMode {
  const host = hostname.toLowerCase();
  const root = environment.platformDomain.toLowerCase();
  if (host === root || host === `www.${root}` || host === '127.0.0.1') return 'marketing';
  if (host === `admin.${root}`) return 'superadmin';
  return 'store';
}

export const APP_MODE: AppMode = detectMode();

export const modeGuard = (mode: AppMode): CanMatchFn => () => APP_MODE === mode;

/** Build a URL on another of our hosts (e.g. after signup -> kavya.myshop.com/admin) keeping dev port */
export function hostUrl(host: string, path = '/'): string {
  const port = window.location.port ? `:${window.location.port}` : '';
  return `${window.location.protocol}//${host}${port}${path}`;
}

export const platformHost = () => environment.platformDomain;
export const storeHost = (sub: string) => `${sub}.${environment.platformDomain}`;
export { inject };
