import { Injectable, inject, signal, computed } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Api } from '../shared/api.service';
import { AuthStore } from '../shared/auth';

export interface MenuNode { id: number; code: string; label: string; icon: string | null; route: string; children: MenuNode[] }
export interface Me {
  user: { id: number; name: string; email: string; is_owner: boolean };
  permissions: string[]; modules: string[]; impersonatedBy: number | null;
  store: { name: string; subdomain: string; primaryDomain: string; status: string; trialEndsAt: string | null; plan: { code: string; name: string } };
}

/** Logged-in store user: permissions + menus from the API (PDF §5.1/§5.2) */
@Injectable({ providedIn: 'root' })
export class AdminSession {
  private api = inject(Api);
  private auth = inject(AuthStore);
  readonly me = signal<Me | null>(null);
  readonly menus = signal<MenuNode[]>([]);
  readonly store = computed(() => this.me()?.store);

  can = (...perms: string[]) => !!this.me() && perms.some((p) => this.me()!.permissions.includes(p));
  hasModule = (m: string) => !!this.me()?.modules.includes(m);

  async load() {
    const [me, menus] = await Promise.all([this.api.get<Me>('/api/me'), this.api.get<MenuNode[]>('/api/me/menus')]);
    this.me.set(me); this.menus.set(menus);
  }
  async reloadMenus() { this.menus.set(await this.api.get<MenuNode[]>('/api/me/menus')); }
  async logout() {
    const t = this.auth.get('user');
    if (t) await this.api.post('/api/admin/auth/logout', { refreshToken: t.refreshToken }).catch(() => null);
    this.auth.clear('user'); this.me.set(null);
  }
  /** first route the user may open (staff may not have Dashboard) */
  firstRoute(): string {
    const flat = this.menus().flatMap((m) => (m.route ? [m.route] : m.children.map((c) => c.route)));
    return flat[0] ?? '/admin/no-access';
  }
}

export const adminAuthGuard: CanActivateFn = async () => {
  const auth = inject(AuthStore); const router = inject(Router); const s = inject(AdminSession);
  if (!auth.get('user')) return router.parseUrl('/admin/login');
  if (!s.me()) { try { await s.load(); } catch { auth.clear('user'); return router.parseUrl('/admin/login'); } }
  return true;
};

/** route-level permission check (backend checks again — this only hides UI) */
export const permGuard = (...perms: string[]): CanActivateFn => () => {
  const s = inject(AdminSession); const router = inject(Router);
  return s.can(...perms) ? true : router.parseUrl(s.firstRoute());
};
