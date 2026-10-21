import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Api, errMsg } from '../../shared/api.service';
import { AuthStore } from '../../shared/auth';
import { InrPipe, Toast, BadgeComponent } from '../../shared/ui';
import { StorefrontService } from '../storefront.service';

/** Customer account — separate per shop (PDF §4) */
@Component({
  selector: 'sf-account',
  imports: [FormsModule, DatePipe, InrPipe, BadgeComponent],
  template: `
    <div class="sf-wrap" style="max-width:860px">
      @if (!auth.customerLoggedIn()) {
        <h1 class="sf-page-title">{{ mode() === 'login' ? 'Login' : 'Create account' }}</h1>
        <form class="sf-form" (ngSubmit)="submit()">
          @if (mode() === 'register') { <label>Name<input [(ngModel)]="f.name" name="name" required /></label> }
          @if (mode() === 'register') {
            <label>Mobile<input [(ngModel)]="f.mobile" name="mobile" required /></label>
            <label>Email (optional)<input [(ngModel)]="f.email" name="email" type="email" /></label>
          } @else { <label>Mobile or email<input [(ngModel)]="f.login" name="login" required /></label> }
          <label>Password<input [(ngModel)]="f.password" name="password" type="password" required minlength="8" /></label>
          <button class="sf-btn">{{ mode() === 'login' ? 'Login' : 'Create account' }}</button>
          <button type="button" class="sf-btn ghost" (click)="mode.set(mode() === 'login' ? 'register' : 'login')">
            {{ mode() === 'login' ? 'New here? Create an account' : 'Have an account? Login' }}</button>
        </form>
      } @else {
        <div style="display:flex;justify-content:space-between;align-items:center"><h1 class="sf-page-title">Hello, {{ me()?.name }}</h1>
          <button class="sf-btn ghost" (click)="logout()">Logout</button></div>
        <h3>My orders</h3>
        <table class="sf-table">
          @for (o of orders(); track o.id) {
            <tr (click)="open(o.order_number)" style="cursor:pointer"><td><b>{{ o.order_number }}</b></td><td>{{ o.placed_at | date: 'mediumDate' }}</td>
              <td><ms-badge [value]="o.status" /></td><td style="text-align:right">{{ o.grand_total | inr }}</td></tr>
          } @empty { <tr><td>No orders yet.</td></tr> }
        </table>
        @if (cursor()) { <button class="sf-btn ghost" (click)="loadOrders()">Load more</button> }
        @if (detail(); as d) {
          <div class="sf-card" style="margin-top:16px">
            <h3>{{ d.order_number }} <ms-badge [value]="d.status" /></h3>
            @for (i of d.items; track i.id) { <div style="display:flex;justify-content:space-between"><span>{{ i.product_name }} × {{ i.quantity }}</span><span>{{ i.line_total | inr }}</span></div> }
            <ul class="sf-timeline">@for (h of d.history; track h.id) { <li>{{ h.to_status }} · {{ h.created_at | date: 'medium' }}</li> }</ul>
            @if (d.status === 'PENDING') { <button class="sf-btn ghost" (click)="cancel(d.order_number)">Cancel order</button> }
          </div>
        }
      }
    </div>`,
})
export class AccountPage implements OnInit {
  auth = inject(AuthStore); private api = inject(Api); private toast = inject(Toast); private sf = inject(StorefrontService);
  mode = signal<'login' | 'register'>('login');
  f: any = { name: '', mobile: '', email: '', login: '', password: '' };
  me = signal<any>(null); orders = signal<any[]>([]); cursor = signal<string | null>(null); detail = signal<any>(null);

  ngOnInit() { this.sf.setSeo('My account'); if (this.auth.customerLoggedIn()) this.loadMe(); }
  async submit() {
    try {
      const t = this.mode() === 'login'
        ? await this.api.post('/api/customer/auth/login', { login: this.f.login, password: this.f.password })
        : await this.api.post('/api/customer/auth/register', { name: this.f.name, mobile: this.f.mobile, email: this.f.email || null, password: this.f.password });
      this.auth.set('customer', t);
      this.loadMe();
    } catch (e) { this.toast.err(errMsg(e)); }
  }
  async loadMe() {
    this.me.set(await this.api.get('/api/customer/me'));
    this.orders.set([]); this.cursor.set(null);
    this.loadOrders();
  }
  async loadOrders() {
    const r = await this.api.get('/api/customer/orders', { cursor: this.cursor() ?? undefined });
    this.orders.update((l) => [...l, ...r.items]); this.cursor.set(r.nextCursor);
  }
  async open(n: string) { this.detail.set(await this.api.get(`/api/customer/orders/${n}`)); }
  async cancel(n: string) {
    try { await this.api.post(`/api/customer/orders/${n}/cancel`); this.toast.ok('Order cancelled'); this.open(n); this.loadMe(); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
  async logout() {
    const t = this.auth.get('customer');
    if (t) await this.api.post('/api/customer/auth/logout', { refreshToken: t.refreshToken }).catch(() => null);
    this.auth.clear('customer'); this.me.set(null);
  }
}
