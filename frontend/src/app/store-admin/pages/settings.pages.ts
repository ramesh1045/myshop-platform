import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api, errMsg } from '../../shared/api.service';
import { BadgeComponent, Toast } from '../../shared/ui';
import { AdminSession } from '../admin-session';

// ------------------------------------------------------------------ STORE & SHIPPING
@Component({
  selector: 'sa-store-settings',
  imports: [FormsModule],
  template: `
    <div class="page-head"><h1>Store settings</h1><span class="spacer"></span><button class="btn primary" (click)="save()">Save</button></div>
    @if (f) {
    <div class="grid c2" style="align-items:start">
      <div class="card stack"><h3>Business details</h3>
        <label class="field"><span>Store name</span><input [(ngModel)]="f.name" /></label>
        <label class="field"><span>Legal name (for invoices)</span><input [(ngModel)]="f.legalName" /></label>
        <label class="field"><span>GSTIN</span><input [(ngModel)]="f.gstin" maxlength="15" /></label>
        <label class="field"><span>Address line 1</span><input [(ngModel)]="f.addressLine1" /></label>
        <label class="field"><span>Address line 2</span><input [(ngModel)]="f.addressLine2" /></label>
        <div class="grid c2"><label class="field"><span>City</span><input [(ngModel)]="f.city" /></label><label class="field"><span>Pincode</span><input [(ngModel)]="f.pincode" /></label></div>
        <div class="grid c2"><label class="field"><span>State</span><input [(ngModel)]="f.state" /></label><label class="field"><span>GST state code</span><input [(ngModel)]="f.stateCode" maxlength="2" placeholder="33" /></label></div>
      </div>
      <div class="stack">
        <div class="card stack"><h3>Contact</h3>
          <label class="field"><span>Store email</span><input [(ngModel)]="f.storeEmail" type="email" /></label>
          <label class="field"><span>Phone</span><input [(ngModel)]="f.storePhone" /></label>
          <label class="field"><span>WhatsApp number (with country code, e.g. 919876543210)</span><input [(ngModel)]="f.whatsappNumber" /></label>
          @for (k of socials; track k) { <label class="field"><span>{{ k }} URL</span><input [(ngModel)]="f.socialLinks[k]" /></label> }
        </div>
        <div class="card stack"><h3>Shipping & checkout</h3>
          <label class="field"><span>Flat shipping fee (₹)</span><input type="number" [(ngModel)]="f.shippingFlatFee" /></label>
          <label class="field"><span>Free shipping above (₹, empty = never)</span><input type="number" [(ngModel)]="f.freeShippingAbove" /></label>
          <label class="field"><span>Minimum order amount (₹)</span><input type="number" [(ngModel)]="f.minOrderAmount" /></label>
          <label class="check"><input type="checkbox" [(ngModel)]="f.pricesIncludeTax" /> Product prices include GST</label>
        </div>
      </div>
    </div>
    }`,
})
export class StoreSettingsPage implements OnInit {
  f: any = null; socials = ['instagram', 'facebook', 'youtube'];
  private api = inject(Api); private toast = inject(Toast);
  async ngOnInit() {
    const s = await this.api.get('/api/admin/settings/store');
    this.f = { name: s.name, legalName: s.legal_name, gstin: s.gstin ?? '', addressLine1: s.address_line1, addressLine2: s.address_line2, city: s.city, state: s.state,
      stateCode: s.state_code, pincode: s.pincode, storeEmail: s.store_email, storePhone: s.store_phone, whatsappNumber: s.whatsapp_number,
      shippingFlatFee: s.shipping_flat_fee, freeShippingAbove: s.free_shipping_above, minOrderAmount: s.min_order_amount, pricesIncludeTax: s.prices_include_tax,
      socialLinks: s.social_links ?? {} };
  }
  async save() {
    const n = (v: any) => (v === '' || v === null || v === undefined ? null : Number(v));
    const e = (v: any) => (v === '' ? null : v);
    const f = this.f;
    try {
      await this.api.put('/api/admin/settings/store', { ...f, legalName: e(f.legalName), gstin: f.gstin || '', stateCode: e(f.stateCode), storeEmail: e(f.storeEmail),
        shippingFlatFee: Number(f.shippingFlatFee || 0), freeShippingAbove: n(f.freeShippingAbove), minOrderAmount: Number(f.minOrderAmount || 0) });
      this.toast.ok('Saved');
    } catch (err) { this.toast.err(errMsg(err)); }
  }
}

// ------------------------------------------------------------------ PAYMENTS (client's own Razorpay keys — PDF §3 step 4)
@Component({
  selector: 'sa-payment-settings',
  imports: [FormsModule],
  template: `
    <div class="page-head"><h1>Payments</h1></div>
    @if (s(); as s) {
    <div class="card stack" style="max-width:640px">
      <p class="muted">Online payments go <b>directly to your own Razorpay account</b>. Get keys from Razorpay Dashboard → Settings → API Keys.</p>
      <label class="check"><input type="checkbox" [(ngModel)]="f.codEnabled" /> Accept Cash on Delivery</label>
      <label class="check"><input type="checkbox" [(ngModel)]="f.onlinePaymentEnabled" /> Accept online payment (Razorpay)</label>
      <label class="field"><span>Razorpay Key ID</span><input [(ngModel)]="f.razorpayKeyId" placeholder="rzp_live_xxxxx" /></label>
      <label class="field"><span>Razorpay Key Secret {{ s.hasKeySecret ? '(saved — enter to replace)' : '' }}</span><input type="password" [(ngModel)]="f.razorpayKeySecret" autocomplete="new-password" /></label>
      <label class="field"><span>Webhook secret {{ s.hasWebhookSecret ? '(saved)' : '(optional)' }}</span><input type="password" [(ngModel)]="f.razorpayWebhookSecret" autocomplete="new-password" /></label>
      <div class="alert">Webhook URL for Razorpay (event: payment.captured):<br /><code>{{ s.webhookUrl }}</code></div>
      <button class="btn primary" (click)="save()">Save</button>
    </div>
    }`,
})
export class PaymentSettingsPage implements OnInit {
  s = signal<any>(null); f: any = {};
  private api = inject(Api); private toast = inject(Toast);
  async ngOnInit() { const s = await this.api.get('/api/admin/settings/payments'); this.s.set(s);
    this.f = { codEnabled: s.codEnabled, onlinePaymentEnabled: s.onlinePaymentEnabled, razorpayKeyId: s.razorpayKeyId ?? '', razorpayKeySecret: '', razorpayWebhookSecret: '' }; }
  async save() {
    const b: any = { codEnabled: this.f.codEnabled, onlinePaymentEnabled: this.f.onlinePaymentEnabled, razorpayKeyId: this.f.razorpayKeyId || null };
    if (this.f.razorpayKeySecret) b.razorpayKeySecret = this.f.razorpayKeySecret;
    if (this.f.razorpayWebhookSecret) b.razorpayWebhookSecret = this.f.razorpayWebhookSecret;
    try { await this.api.put('/api/admin/settings/payments', b); this.toast.ok('Payment settings saved'); this.ngOnInit(); } catch (e) { this.toast.err(errMsg(e)); }
  }
}

// ------------------------------------------------------------------ SEO
@Component({
  selector: 'sa-seo',
  imports: [FormsModule],
  template: `
    <div class="page-head"><h1>SEO</h1></div>
    <div class="card stack" style="max-width:640px">
      <label class="field"><span>Home page title</span><input [(ngModel)]="f.seoTitle" maxlength="200" /></label>
      <label class="field"><span>Meta description</span><textarea [(ngModel)]="f.seoDescription" maxlength="500"></textarea></label>
      <label class="field"><span>Keywords</span><input [(ngModel)]="f.seoKeywords" /></label>
      <label class="field"><span>Google Analytics ID (G-XXXX)</span><input [(ngModel)]="f.googleAnalyticsId" /></label>
      <p class="muted">Sitemap: <a href="/sitemap.xml" target="_blank">/sitemap.xml</a> · robots: <a href="/robots.txt" target="_blank">/robots.txt</a> (automatic)</p>
      <button class="btn primary" (click)="save()">Save</button>
    </div>`,
})
export class SeoSettingsPage implements OnInit {
  f: any = {};
  private api = inject(Api); private toast = inject(Toast);
  async ngOnInit() { const s = await this.api.get('/api/admin/settings/seo');
    this.f = { seoTitle: s.seo_title ?? '', seoDescription: s.seo_description ?? '', seoKeywords: s.seo_keywords ?? '', googleAnalyticsId: s.google_analytics_id ?? '' }; }
  async save() {
    const e = (v: string) => v || null;
    await this.api.put('/api/admin/settings/seo', { seoTitle: e(this.f.seoTitle), seoDescription: e(this.f.seoDescription), seoKeywords: e(this.f.seoKeywords), googleAnalyticsId: e(this.f.googleAnalyticsId) });
    this.toast.ok('Saved');
  }
}

// ------------------------------------------------------------------ DOMAINS (PDF §2, §3 step 6)
@Component({
  selector: 'sa-domains',
  imports: [FormsModule, DatePipe, BadgeComponent, RouterLink],
  template: `
    <div class="page-head"><h1>Domains</h1></div>
    @if (d(); as d) {
      <div class="card" style="padding:0"><table class="table">
        <tr><th>Domain</th><th>Type</th><th>Status</th><th>Last check</th><th></th></tr>
        @for (x of d.domains; track x.id) {
          <tr><td><b>{{ x.domain }}</b>@if (x.is_primary) { <span class="badge">Primary</span> }@if (x.last_check_error) {<br /><small class="muted">{{ x.last_check_error }}</small>}</td>
            <td>{{ x.type }}</td><td><ms-badge [value]="x.verification_status" /></td><td>{{ x.last_checked_at | date: 'short' }}</td>
            <td>@if (x.type === 'CUSTOM') {
              @if (x.verification_status !== 'VERIFIED') { <button class="btn sm" (click)="verify(x)">Check now</button> }
              @if (x.verification_status === 'VERIFIED' && !x.is_primary) { <button class="btn sm" (click)="primary(x)">Make primary</button> }
              <button class="btn sm danger" (click)="remove(x)">Remove</button> }</td></tr>
        }
      </table></div>
      @if (d.customDomainAllowed && s.hasModule('CUSTOM_DOMAIN')) {
        <div class="card stack mt" style="max-width:640px">
          <h3>Connect your own domain</h3>
          <div class="row"><input [(ngModel)]="domain" placeholder="shop.kavyatextiles.com or kavyatextiles.com" /><button class="btn primary" (click)="add()">Add</button></div>
          <div class="alert">
            At your domain provider (GoDaddy, Hostinger…) add a DNS record:<br />
            <b>Type:</b> CNAME · <b>Name:</b> www (or shop) · <b>Value:</b> <code>{{ d.cnameTarget }}</code><br />
            @if (d.serverIp) { For a root domain (no www) add an <b>A</b> record to <code>{{ d.serverIp }}</code>.<br /> }
            We check automatically every 10 minutes. SSL (https) is issued automatically once verified.
          </div>
        </div>
      } @else {
        <div class="alert mt">Custom domains are available on the Pro plan and above. <a routerLink="/admin/billing">Upgrade</a></div>
      }
    }`,
})
export class DomainsPage implements OnInit {
  s = inject(AdminSession); d = signal<any>(null); domain = '';
  private api = inject(Api); private toast = inject(Toast);
  ngOnInit() { this.load(); }
  async load() { this.d.set(await this.api.get('/api/admin/domains')); }
  async add() { try { await this.api.post('/api/admin/domains', { domain: this.domain }); this.domain = ''; this.load(); this.toast.ok('Domain added — now add the DNS record'); } catch (e) { this.toast.err(errMsg(e)); } }
  async verify(x: any) { const r = await this.api.post(`/api/admin/domains/${x.id}/verify`); this.toast[r.status === 'VERIFIED' ? 'ok' : 'err'](r.status === 'VERIFIED' ? 'Verified!' : r.error || 'Not yet'); this.load(); }
  async primary(x: any) { await this.api.put(`/api/admin/domains/${x.id}/primary`); this.load(); }
  async remove(x: any) { if (confirm(`Remove ${x.domain}?`)) { await this.api.delete(`/api/admin/domains/${x.id}`); this.load(); } }
}

// ------------------------------------------------------------------ HEADLESS API KEYS (PDF §9)
@Component({
  selector: 'sa-api-keys',
  imports: [FormsModule, DatePipe],
  template: `
    <div class="page-head"><h1>API keys (headless)</h1></div>
    <p class="muted">Use these keys to build your own website/app on top of your store. Send header <code>X-API-Key</code> to <code>/api/headless/v1/...</code></p>
    <div class="card stack mb" style="max-width:640px">
      <div class="row"><input [(ngModel)]="name" placeholder="Key name e.g. My website" />
        @for (sc of scopes; track sc) { <label class="check"><input type="checkbox" [(ngModel)]="sel[sc]" /> {{ sc }}</label> }
        <button class="btn primary" (click)="create()">Create key</button></div>
      @if (newKey()) { <div class="alert warn">Copy this key now — it will not be shown again:<br /><code>{{ newKey() }}</code></div> }
    </div>
    <div class="card" style="padding:0"><table class="table">
      <tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th></th></tr>
      @for (k of keys(); track k.id) {
        <tr [style.opacity]="k.revoked_at ? .5 : 1"><td>{{ k.name }}</td><td><code>{{ k.key_prefix }}…</code></td><td>{{ k.scopes.join(', ') }}</td><td>{{ k.last_used_at | date: 'short' }}</td>
          <td>@if (!k.revoked_at) { <button class="btn sm danger" (click)="revoke(k)">Revoke</button> } @else { revoked }</td></tr>
      }
    </table></div>`,
})
export class ApiKeysPage implements OnInit {
  keys = signal<any[]>([]); newKey = signal(''); name = '';
  scopes = ['catalog:read', 'orders:write', 'orders:read']; sel: Record<string, boolean> = { 'catalog:read': true };
  private api = inject(Api); private toast = inject(Toast);
  ngOnInit() { this.load(); }
  async load() { this.keys.set(await this.api.get('/api/admin/api-keys')); }
  async create() {
    try { const r = await this.api.post('/api/admin/api-keys', { name: this.name, scopes: this.scopes.filter((s) => this.sel[s]) }); this.newKey.set(r.key); this.name = ''; this.load(); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
  async revoke(k: any) { if (confirm('Revoke this key?')) { await this.api.delete(`/api/admin/api-keys/${k.id}`); this.load(); } }
}
