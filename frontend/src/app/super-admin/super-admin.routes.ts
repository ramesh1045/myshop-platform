import { Component, inject, signal } from '@angular/core';
import { CanActivateFn, Router, RouterLink, RouterLinkActive, RouterOutlet, Routes } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api, errMsg } from '../shared/api.service';
import { AuthStore } from '../shared/auth';
import { Toast } from '../shared/ui';

const platformGuard: CanActivateFn = () => inject(AuthStore).get('platform') ? true : inject(Router).parseUrl('/login');

@Component({
  selector: 'pf-login',
  imports: [FormsModule],
  template: `
    <div class="auth-page"><div class="card auth-card"><h1>Super Admin</h1><p class="muted">Platform owner login</p>
      <form class="stack" (ngSubmit)="login()">
        <label class="field"><span>Email</span><input [(ngModel)]="email" name="e" type="email" required /></label>
        <label class="field"><span>Password</span><input [(ngModel)]="password" name="p" type="password" required /></label>
        <button class="btn primary">Login</button></form></div></div>`,
})
export class PlatformLogin {
  email = ''; password = '';
  private api = inject(Api); private auth = inject(AuthStore); private router = inject(Router); private toast = inject(Toast);
  async login() {
    try { this.auth.set('platform', await this.api.post('/api/platform/auth/login', { email: this.email, password: this.password })); this.router.navigateByUrl('/'); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
}

@Component({
  selector: 'pf-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell">
      <aside>
        <div class="brand"><span class="mi">admin_panel_settings</span> Super Admin</div>
        @for (m of menu; track m.r) { <a [routerLink]="m.r" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: m.r === '/' }"><span class="mi">{{ m.i }}</span>{{ m.l }}</a> }
      </aside>
      <main>
        <div class="topbar"><span class="spacer"></span><span class="muted">{{ me()?.email }}</span><button class="btn sm" (click)="logout()">Logout</button></div>
        <router-outlet />
      </main>
    </div>`,
})
export class PlatformShell {
  menu = [
    { r: '/', l: 'Dashboard', i: 'dashboard' }, { r: '/tenants', l: 'Clients (stores)', i: 'store' }, { r: '/plans', l: 'Plans', i: 'workspace_premium' },
    { r: '/modules', l: 'Modules & add-ons', i: 'extension' }, { r: '/themes', l: 'Themes', i: 'palette' }, { r: '/permissions', l: 'Permissions', i: 'shield' },
    { r: '/subscriptions', l: 'Subscriptions', i: 'autorenew' }, { r: '/invoices', l: 'Invoices', i: 'receipt' }, { r: '/service-requests', l: 'Service requests', i: 'support_agent' },
    { r: '/audit', l: 'Audit log', i: 'history' }, { r: '/settings', l: 'Settings', i: 'settings' },
  ];
  me = signal<any>(null);
  private api = inject(Api); private auth = inject(AuthStore); private router = inject(Router);
  constructor() { this.api.get('/api/platform/me').then((m) => this.me.set(m)).catch(() => null); }
  async logout() {
    const t = this.auth.get('platform');
    if (t) await this.api.post('/api/platform/auth/logout', { refreshToken: t.refreshToken }).catch(() => null);
    this.auth.clear('platform'); this.router.navigateByUrl('/login');
  }
}

const P = () => import('./pages/platform.pages');

/** admin.myshop.com — you manage every client, plan, theme, permission and subscription (PDF §4) */
export const SUPER_ADMIN_ROUTES: Routes = [
  { path: 'login', component: PlatformLogin },
  { path: '', component: PlatformShell, canActivate: [platformGuard], children: [
    { path: '', loadComponent: () => P().then((m) => m.PfDashboard) },
    { path: 'tenants', loadComponent: () => P().then((m) => m.PfTenants) },
    { path: 'tenants/:id', loadComponent: () => P().then((m) => m.PfTenantDetail) },
    { path: 'plans', loadComponent: () => P().then((m) => m.PfPlans) },
    { path: 'modules', loadComponent: () => P().then((m) => m.PfModules) },
    { path: 'themes', loadComponent: () => P().then((m) => m.PfThemes) },
    { path: 'permissions', loadComponent: () => P().then((m) => m.PfPermissions) },
    { path: 'subscriptions', loadComponent: () => P().then((m) => m.PfSubscriptions) },
    { path: 'invoices', loadComponent: () => P().then((m) => m.PfInvoices) },
    { path: 'service-requests', loadComponent: () => P().then((m) => m.PfServiceRequests) },
    { path: 'audit', loadComponent: () => P().then((m) => m.PfAudit) },
    { path: 'settings', loadComponent: () => P().then((m) => m.PfSettings) },
  ] },
];
