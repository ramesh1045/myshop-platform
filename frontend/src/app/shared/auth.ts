import { Injectable, computed, signal } from '@angular/core';

/**
 * Three independent sessions, stored per host so shop A's login never leaks to shop B:
 *   platform (super admin), user (store owner/staff), customer (shopper)
 */
export type Scope = 'platform' | 'user' | 'customer';

interface Tokens { accessToken: string; refreshToken: string }

function key(scope: Scope) {
  return `ms:${location.host}:${scope}`;
}
function read(scope: Scope): Tokens | null {
  try { return JSON.parse(localStorage.getItem(key(scope)) || 'null'); } catch { return null; }
}

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private state = {
    platform: signal<Tokens | null>(read('platform')),
    user: signal<Tokens | null>(read('user')),
    customer: signal<Tokens | null>(read('customer')),
  };

  readonly userLoggedIn = computed(() => !!this.state.user());
  readonly customerLoggedIn = computed(() => !!this.state.customer());
  readonly platformLoggedIn = computed(() => !!this.state.platform());

  get(scope: Scope) { return this.state[scope](); }
  set(scope: Scope, t: Tokens | null) {
    this.state[scope].set(t);
    try {
      if (t) localStorage.setItem(key(scope), JSON.stringify(t));
      else localStorage.removeItem(key(scope));
    } catch { /* private mode */ }
  }
  clear(scope: Scope) { this.set(scope, null); }
}

/** Which session a request belongs to (by URL) */
export function scopeForUrl(url: string): Scope | null {
  if (url.startsWith('/api/platform')) return 'platform';
  if (url.startsWith('/api/admin') || url.startsWith('/api/me')) return 'user';
  if (url.startsWith('/api/customer') || url.startsWith('/api/public/checkout')) return 'customer';
  return null;
}

export const refreshUrl: Record<Scope, string> = {
  platform: '/api/platform/auth/refresh',
  user: '/api/admin/auth/refresh',
  customer: '/api/customer/auth/refresh',
};
