import { Component, OnInit, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api, errMsg } from '../../shared/api.service';
import { AuthStore } from '../../shared/auth';
import { Toast } from '../../shared/ui';
import { AdminSession } from '../admin-session';

@Component({
  selector: 'sa-login',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-page"><div class="card auth-card">
      <h1>{{ host }}</h1><p class="muted">Store admin login (owner & staff)</p>
      <form class="stack" (ngSubmit)="login()">
        <label class="field"><span>Email</span><input [(ngModel)]="email" name="email" type="email" required autocomplete="username" /></label>
        <label class="field"><span>Password</span><input [(ngModel)]="password" name="password" type="password" required autocomplete="current-password" /></label>
        <button class="btn primary" [disabled]="busy()">Login</button>
        <a routerLink="/admin/forgot-password">Forgot password?</a>
      </form>
    </div></div>`,
})
export class LoginPage {
  host = location.hostname;
  email = new URLSearchParams(location.search).get('email') ?? ''; password = ''; busy = signal(false);
  private api = inject(Api); private auth = inject(AuthStore); private router = inject(Router); private toast = inject(Toast); private s = inject(AdminSession);
  async login() {
    this.busy.set(true);
    try {
      this.auth.set('user', await this.api.post('/api/admin/auth/login', { email: this.email, password: this.password }));
      await this.s.load();
      this.router.navigateByUrl(this.s.firstRoute());
    } catch (e) { this.toast.err(errMsg(e)); } finally { this.busy.set(false); }
  }
}

/** Staff accepts the email invitation and sets a password (PDF §5.3) */
@Component({
  selector: 'sa-accept',
  imports: [FormsModule],
  template: `
    <div class="auth-page"><div class="card auth-card">
      @if (info(); as i) {
        <h1>Welcome, {{ i.name }}</h1><p class="muted">Set a password for {{ i.email }}</p>
        <form class="stack" (ngSubmit)="accept()">
          <label class="field"><span>Password (min 8)</span><input [(ngModel)]="password" name="p" type="password" minlength="8" required /></label>
          <button class="btn primary">Join store</button>
        </form>
      } @else { <p>{{ error() || 'Checking invitation…' }}</p> }
    </div></div>`,
})
export class AcceptInvitePage implements OnInit {
  token = input<string>();
  info = signal<any>(null); error = signal(''); password = '';
  private api = inject(Api); private auth = inject(AuthStore); private router = inject(Router); private s = inject(AdminSession); private toast = inject(Toast);
  async ngOnInit() {
    try { this.info.set(await this.api.get('/api/admin/auth/invitation', { token: this.token() })); } catch (e) { this.error.set(errMsg(e)); }
  }
  async accept() {
    try {
      this.auth.set('user', await this.api.post('/api/admin/auth/accept-invite', { token: this.token(), password: this.password }));
      await this.s.load(); this.router.navigateByUrl(this.s.firstRoute());
    } catch (e) { this.toast.err(errMsg(e)); }
  }
}

@Component({
  selector: 'sa-forgot',
  imports: [FormsModule, RouterLink],
  template: `<div class="auth-page"><div class="card auth-card"><h1>Reset password</h1>
    @if (sent()) { <p>If the email exists, a reset link has been sent.</p> } @else {
    <form class="stack" (ngSubmit)="send()"><label class="field"><span>Email</span><input [(ngModel)]="email" name="e" type="email" required /></label>
      <button class="btn primary">Send link</button></form> }
    <p class="mt"><a routerLink="/admin/login">Back to login</a></p></div></div>`,
})
export class ForgotPage {
  email = ''; sent = signal(false);
  private api = inject(Api);
  async send() { await this.api.post('/api/admin/auth/forgot-password', { email: this.email }).catch(() => null); this.sent.set(true); }
}

@Component({
  selector: 'sa-reset',
  imports: [FormsModule],
  template: `<div class="auth-page"><div class="card auth-card"><h1>New password</h1>
    <form class="stack" (ngSubmit)="save()"><label class="field"><span>Password</span><input [(ngModel)]="password" name="p" type="password" minlength="8" required /></label>
      <button class="btn primary">Save</button></form></div></div>`,
})
export class ResetPage {
  token = input<string>(); password = '';
  private api = inject(Api); private router = inject(Router); private toast = inject(Toast);
  async save() {
    try { await this.api.post('/api/admin/auth/reset-password', { token: this.token(), password: this.password }); this.toast.ok('Password changed'); this.router.navigateByUrl('/admin/login'); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
}

/** Super Admin "login as client" lands here with #token=... (PDF §12 phase 5) */
@Component({ selector: 'sa-imp', template: `<div class="auth-page"><p>Opening store admin…</p></div>` })
export class ImpersonatePage implements OnInit {
  private auth = inject(AuthStore); private router = inject(Router); private s = inject(AdminSession);
  async ngOnInit() {
    const token = new URLSearchParams(location.hash.slice(1)).get('token');
    if (token) {
      this.auth.set('user', { accessToken: token, refreshToken: '' });
      history.replaceState(null, '', '/admin');
      await this.s.load().catch(() => null);
    }
    this.router.navigateByUrl(this.s.me() ? this.s.firstRoute() : '/admin/login');
  }
}

@Component({ selector: 'sa-landing', template: `` })
export class LandingRedirect implements OnInit {
  private s = inject(AdminSession); private router = inject(Router);
  ngOnInit() { this.router.navigateByUrl(this.s.firstRoute(), { replaceUrl: true }); }
}

@Component({ selector: 'sa-noaccess', template: `<div class="card"><h2>No menus assigned</h2><p>Ask the store owner to give your role some permissions.</p></div>` })
export class NoAccessPage {}

@Component({
  selector: 'sa-my-account',
  imports: [FormsModule],
  template: `
    <div class="page-head"><h1>My account</h1></div>
    <div class="card" style="max-width:480px">
      <p><b>{{ s.me()?.user?.name }}</b><br /><span class="muted">{{ s.me()?.user?.email }}</span></p>
      <h3>Change password</h3>
      <form class="stack" (ngSubmit)="change()">
        <label class="field"><span>Current password</span><input type="password" [(ngModel)]="cur" name="c" required /></label>
        <label class="field"><span>New password</span><input type="password" [(ngModel)]="nw" name="n" minlength="8" required /></label>
        <button class="btn primary">Update</button>
      </form>
      <h3 class="mt">My permissions</h3>
      <p class="muted">{{ s.me()?.permissions?.join(', ') }}</p>
    </div>`,
})
export class MyAccountPage {
  s = inject(AdminSession); cur = ''; nw = '';
  private api = inject(Api); private toast = inject(Toast);
  async change() {
    try { await this.api.put('/api/me/password', { currentPassword: this.cur, newPassword: this.nw }); this.toast.ok('Password updated'); this.cur = this.nw = ''; }
    catch (e) { this.toast.err(errMsg(e)); }
  }
}
