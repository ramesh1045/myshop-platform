import { Component, OnInit, inject, signal } from '@angular/core';
import { Routes, RouterLink, RouterOutlet, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api, errMsg } from '../shared/api.service';
import { InrPipe, Toast, openRazorpay } from '../shared/ui';
import { hostUrl, storeHost } from '../shared/app-mode';

/** myshop.com — your own website: features, plans, signup (PDF §2, §3 steps 1–2) */
@Component({
  selector: 'mk-shell',
  imports: [RouterOutlet, RouterLink],
  template: `
    <header class="mk-head"><div class="mk-wrap row"><a routerLink="/" class="brand">MyShop</a><span class="spacer"></span>
      <a routerLink="/" fragment="features">Features</a><a routerLink="/pricing">Pricing</a><a class="btn primary" routerLink="/signup">Start free trial</a></div></header>
    <router-outlet />
    <footer class="mk-foot"><div class="mk-wrap">© {{ year }} MyShop · Your online store in 5 minutes</div></footer>`,
  styles: [`
    :host { display: block; background: #fff; }
    .mk-head { border-bottom: 1px solid var(--ui-border); position: sticky; top: 0; background: #fff; z-index: 5; }
    .mk-head .row { padding: 14px 0; gap: 20px; } .brand { font-weight: 800; font-size: 20px; color: var(--ui-text); }
    .mk-foot { border-top: 1px solid var(--ui-border); padding: 24px 0; color: var(--ui-muted); margin-top: 60px; }
    :host ::ng-deep .mk-wrap { max-width: 1120px; margin: 0 auto; padding: 0 16px; }
  `],
})
export class MarketingShell { year = new Date().getFullYear(); }

@Component({
  selector: 'mk-home',
  imports: [RouterLink],
  template: `
    <section class="hero"><div class="mk-wrap">
      <h1>Your own online shop.<br />Your brand, your domain, your payments.</h1>
      <p>Tea & coffee powder, soaps, shoes, dresses — start selling online today on <b>yourshop.{{ domain }}</b> or your own domain.</p>
      <a class="btn primary big" routerLink="/signup">Start 14-day free trial</a> <a class="btn big" routerLink="/pricing">See pricing</a>
    </div></section>
    <section id="features" class="mk-wrap grid c3 feats">
      @for (f of features; track f.t) { <div class="card"><span class="mi" style="font-size:32px;color:var(--ui-primary)">{{ f.i }}</span><h3>{{ f.t }}</h3><p class="muted">{{ f.d }}</p></div> }
    </section>`,
  styles: [`.hero { background: linear-gradient(135deg, #eff6ff, #fdf4ff); padding: 80px 0; } .hero h1 { font-size: clamp(28px, 4.5vw, 46px); }
    .hero p { font-size: 18px; color: var(--ui-muted); max-width: 640px; } .big { padding: 12px 22px; font-size: 16px; } .feats { margin-top: 48px; }`],
})
export class MarketingHome {
  domain = location.hostname;
  features = [
    { i: 'storefront', t: 'Live in minutes', d: 'Sign up and your shop is live instantly on your own subdomain with SSL.' },
    { i: 'palette', t: 'Your design', d: 'Pick a theme, set your colours, logo and banner, arrange home page blocks with drag & drop.' },
    { i: 'payments', t: 'Money comes to you', d: 'Connect your own Razorpay — customer payments go straight to your bank. COD supported.' },
    { i: 'badge', t: 'Staff & roles', d: 'Create roles like Store Manager or Billing Staff and choose exactly what each can see.' },
    { i: 'language', t: 'Custom domain', d: 'Connect yourshop.com with one DNS record. SSL is automatic.' },
    { i: 'bar_chart', t: 'Reports & coupons', d: 'Track sales, top products and run discount coupons.' },
  ];
}

@Component({
  selector: 'mk-pricing',
  imports: [RouterLink, InrPipe],
  template: `
    <div class="mk-wrap" style="padding:40px 16px">
      <h1 style="text-align:center">Simple pricing</h1>
      <div class="grid c3 mt">
        @for (p of plans(); track p.code) {
          <div class="card stack">
            <h2>{{ p.name }}</h2><div class="stat">{{ p.priceMonthly | inr }}<small class="muted">/month</small></div>
            <small class="muted">or {{ p.priceYearly | inr }}/year</small>
            <p>{{ p.description }}</p>
            <ul>
              <li>{{ p.maxProducts ?? 'Unlimited' }} products</li><li>{{ p.maxStaff ?? 'Unlimited' }} staff users</li>
              <li>{{ p.customDomain ? 'Custom domain' : 'yourshop.' + domain }}</li>
              @if (p.transactionFeePercent > 0) { <li>{{ p.transactionFeePercent }}% per order</li> } @else { <li>No transaction fee</li> }
              @for (m of p.modules; track m.code) { <li>{{ m.name }}</li> }
            </ul>
            <a class="btn primary" [routerLink]="['/signup']" [queryParams]="{ plan: p.code }">Start free trial</a>
          </div>
        }
      </div>
      @if (addons().length) {
        <h2 class="mt">Add-ons</h2>
        <div class="grid c3">@for (a of addons(); track a.code) { <div class="card"><b>{{ a.name }}</b> — {{ a.addon_price_monthly | inr }}/month<p class="muted">{{ a.description }}</p></div> }</div>
      }
      <p class="muted mt">Need help? Store setup service ₹5,000 · Custom design & modules on request · Premium themes available.</p>
    </div>`,
})
export class PricingPage implements OnInit {
  plans = signal<any[]>([]); addons = signal<any[]>([]); domain = location.hostname;
  private api = inject(Api);
  async ngOnInit() { const r = await this.api.get('/api/signup/plans'); this.plans.set(r.plans); this.addons.set(r.addons); }
}

/** Self-signup -> store auto-created (PDF §3 step 2-3, §12 phase 4) */
@Component({
  selector: 'mk-signup',
  imports: [FormsModule, InrPipe],
  template: `
    <div class="mk-wrap" style="max-width:620px;padding:40px 16px">
      @if (done(); as d) {
        <div class="card stack" style="text-align:center"><h1>🎉 Your store is ready!</h1>
          <p>Shop: <a [href]="d.storeUrl" target="_blank">{{ d.storeUrl }}</a></p>
          <a class="btn primary" [href]="d.adminUrl + '?email=' + f.email">Open my admin panel</a></div>
      } @else {
      <h1>Create your store</h1>
      <form class="card stack" (ngSubmit)="submit()">
        <label class="field"><span>Store name</span><input [(ngModel)]="f.storeName" name="sn" required (input)="suggest()" /></label>
        <label class="field"><span>Store address</span>
          <div class="row" style="flex-wrap:nowrap"><input [(ngModel)]="f.subdomain" name="sub" required (input)="check()" style="text-align:right" /><span>.{{ domain }}</span></div>
          @if (avail(); as a) { <small [style.color]="a.available ? '#16a34a' : '#dc2626'">{{ a.available ? 'Available ✓' : a.reason }}</small> }</label>
        <div class="grid c2"><label class="field"><span>Your name</span><input [(ngModel)]="f.ownerName" name="on" required /></label>
          <label class="field"><span>Mobile</span><input [(ngModel)]="f.mobile" name="m" required /></label></div>
        <label class="field"><span>Email (login)</span><input [(ngModel)]="f.email" name="e" type="email" required /></label>
        <label class="field"><span>Password</span><input [(ngModel)]="f.password" name="p" type="password" minlength="8" required /></label>
        <label class="field"><span>Plan</span><select [(ngModel)]="f.planCode" name="pl">@for (p of plans(); track p.code) { <option [value]="p.code">{{ p.name }} – {{ p.priceMonthly | inr }}/month</option> }</select></label>
        <div class="row"><label class="check"><input type="radio" name="cy" value="MONTHLY" [(ngModel)]="f.billingCycle" /> Monthly</label><label class="check"><input type="radio" name="cy" value="YEARLY" [(ngModel)]="f.billingCycle" /> Yearly</label></div>
        <label class="check"><input type="checkbox" [(ngModel)]="f.startTrial" name="t" /> Start with free trial (pay later)</label>
        <button class="btn primary" [disabled]="busy() || avail()?.available === false">{{ f.startTrial ? 'Create my store' : 'Pay & create my store' }}</button>
      </form>
      }
    </div>`,
})
export class SignupPage implements OnInit {
  domain = location.hostname;
  plans = signal<any[]>([]); avail = signal<any>(null); busy = signal(false); done = signal<any>(null);
  f: any = { storeName: '', subdomain: '', ownerName: '', mobile: '', email: '', password: '', planCode: new URLSearchParams(location.search).get('plan') || 'BASIC', billingCycle: 'MONTHLY', startTrial: true };
  private api = inject(Api); private toast = inject(Toast); private t: any;
  async ngOnInit() { this.plans.set((await this.api.get('/api/signup/plans')).plans); }
  suggest() { if (!this.f.subdomainTouched) { this.f.subdomain = this.f.storeName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30); this.check(); } }
  check() {
    clearTimeout(this.t);
    this.t = setTimeout(async () => { if (this.f.subdomain.length >= 3) this.avail.set(await this.api.get('/api/signup/check-subdomain', { subdomain: this.f.subdomain })); }, 300);
  }
  async submit() {
    this.busy.set(true);
    try {
      const r = await this.api.post('/api/signup', { ...this.f, subdomainTouched: undefined });
      if (r.payment?.razorpayOrderId) {
        try {
          const pay = await openRazorpay({ key: r.payment.keyId, orderId: r.payment.razorpayOrderId, amount: r.payment.amount, name: 'MyShop subscription', description: r.payment.invoiceNumber,
            prefill: { name: this.f.ownerName, email: this.f.email, contact: this.f.mobile } });
          await this.api.post('/api/signup/verify-payment', { tenantId: r.tenantId, ...pay });
        } catch { this.toast.err('Payment not completed — you can pay later from Billing in your admin panel.'); }
      }
      this.done.set({ storeUrl: r.storeUrl, adminUrl: r.adminUrl });
    } catch (e) { this.toast.err(errMsg(e)); } finally { this.busy.set(false); }
  }
}

export const MARKETING_ROUTES: Routes = [
  { path: '', component: MarketingShell, children: [
    { path: '', component: MarketingHome },
    { path: 'pricing', component: PricingPage },
    { path: 'signup', component: SignupPage },
    { path: '**', redirectTo: '' },
  ] },
];
export { Router, hostUrl, storeHost };
