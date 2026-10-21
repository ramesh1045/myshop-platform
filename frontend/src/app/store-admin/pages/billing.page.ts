import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api, OffsetPage, errMsg } from '../../shared/api.service';
import { BadgeComponent, InrPipe, PagerComponent, Toast, openRazorpay } from '../../shared/ui';
import { AdminSession } from '../admin-session';

/** Self-service billing (PDF §10 revenue streams, §12 phase 4) */
@Component({
  selector: 'sa-billing',
  imports: [FormsModule, DatePipe, RouterLink, BadgeComponent, InrPipe, PagerComponent],
  template: `
    <div class="page-head"><h1>Plan & billing</h1></div>
    @if (b(); as b) {
      <div class="grid c3">
        <div class="card"><div class="muted">Current plan</div><div class="stat">{{ b.plan.name }}</div><ms-badge [value]="b.plan.status" />
          @if (b.subscription) { <p class="mt">{{ b.subscription.billing_cycle }} · renews {{ b.subscription.current_period_end | date: 'mediumDate' }}</p>
            <label class="check"><input type="checkbox" [ngModel]="b.subscription.auto_renew" (ngModelChange)="autoRenew($event)" /> Auto-renew</label> }
        </div>
        <div class="card"><div class="muted">Usage</div>
          <p>Products: <b>{{ b.usage.products }}</b> / {{ b.limits.maxProducts ?? '∞' }}</p>
          <p>Staff: <b>{{ b.usage.staff }}</b> / {{ b.limits.maxStaff ?? '∞' }}</p>
          <p>Storage: <b>{{ b.usage.storageMb }} MB</b> / {{ b.limits.maxStorageMb ?? '∞' }} MB</p></div>
        <div class="card"><div class="muted">Transaction fees (not yet billed)</div><div class="stat">{{ b.unbilledTransactionFees | inr }}</div>
          <small class="muted">{{ b.plan.transaction_fee_percent }}% per order on your plan, added to the next invoice.</small></div>
      </div>

      <h2 class="mt">Plans</h2>
      <div class="row mb"><label class="check"><input type="radio" name="cy" value="MONTHLY" [(ngModel)]="cycle" /> Monthly</label>
        <label class="check"><input type="radio" name="cy" value="YEARLY" [(ngModel)]="cycle" /> Yearly (2 months free)</label></div>
      <div class="grid c3">
        @for (p of b.plans; track p.id) {
          <div class="card stack" [style.border-color]="p.code === b.plan.code ? 'var(--ui-primary)' : ''">
            <h3>{{ p.name }}</h3><div class="stat">{{ (cycle === 'YEARLY' ? p.price_yearly : p.price_monthly) | inr }}<small class="muted">/{{ cycle === 'YEARLY' ? 'yr' : 'mo' }}</small></div>
            <small>{{ p.max_products ?? 'Unlimited' }} products · {{ p.max_staff ?? 'Unlimited' }} staff · {{ p.allow_custom_domain ? 'Custom domain' : 'Subdomain only' }}
              @if (p.transaction_fee_percent > 0) { · {{ p.transaction_fee_percent }}% per order }</small>
            <button class="btn" [class.primary]="p.code !== b.plan.code" (click)="changePlan(p.code)">{{ p.code === b.plan.code ? 'Renew / pay now' : 'Switch to ' + p.name }}</button>
          </div>
        }
      </div>

      <h2 class="mt">Add-ons</h2>
      <div class="grid c3">
        @for (a of b.addons; track a.id) {
          <div class="card stack"><h3>{{ a.name }}</h3><p class="muted">{{ a.description }}</p><b>{{ a.addon_price_monthly | inr }}/month</b>
            @if (s.hasModule(a.code)) { <ms-badge value="ACTIVE" /> @if (a.source === 'ADDON') { <button class="btn sm" (click)="cancelAddon(a.code)">Cancel at period end</button> } }
            @else { <button class="btn primary" (click)="buyAddon(a.code)">Add</button> }</div>
        }
      </div>

      <h2 class="mt">Premium themes</h2>
      <div class="grid c3">
        @for (t of themes(); track t.id) {
          <div class="card stack"><h3>{{ t.name }}</h3><p class="muted">{{ t.description }}</p><b>{{ t.price | inr }} one-time</b>
            @if (t.owned) { <ms-badge value="ACTIVE" /> } @else { <button class="btn primary" (click)="buyTheme(t.id)">Buy</button> }</div>
        } @empty { <p class="muted">No premium themes.</p> }
      </div>

      <h2 class="mt">Need help?</h2>
      <div class="card stack" style="max-width:640px">
        <p>We can set up your store for you (₹5,000), make a custom design, or build a custom module.</p>
        <div class="row"><select [(ngModel)]="req.requestType" style="width:auto"><option value="STORE_SETUP">Store setup service</option><option value="CUSTOM_DESIGN">Custom design</option>
          <option value="CUSTOM_MODULE">Custom module</option><option value="EXCLUSIVE_THEME">Exclusive theme</option></select>
          <input [(ngModel)]="req.title" placeholder="Short title" /></div>
        <textarea [(ngModel)]="req.description" placeholder="Describe what you need"></textarea>
        <button class="btn" (click)="request()">Send request</button>
        @for (r of requests(); track r.id) { <div class="row between"><span>{{ r.title }}</span><ms-badge [value]="r.status" /><span>{{ r.quoted_amount ? (r.quoted_amount | inr) : '' }}</span></div> }
      </div>

      <h2 class="mt">Invoices</h2>
      <div class="card" style="padding:0"><table class="table">
        <tr><th>Number</th><th>Type</th><th>Issued</th><th>Due</th><th class="num">Total</th><th>Status</th><th></th></tr>
        @for (i of invoices()?.items; track i.id) {
          <tr><td><a [routerLink]="['/admin/billing/invoices', i.id]">{{ i.invoice_number }}</a></td><td>{{ i.invoice_type }}</td><td>{{ i.issued_at | date: 'mediumDate' }}</td>
            <td>{{ i.due_at | date: 'mediumDate' }}</td><td class="num">{{ i.total | inr }}</td><td><ms-badge [value]="i.status" /></td>
            <td>@if (i.status === 'ISSUED') { <button class="btn sm primary" (click)="pay(i.id)">Pay</button> }</td></tr>
        } @empty { <tr><td colspan="7" class="muted">No invoices yet.</td></tr> }
      </table></div>
      <ms-pager [page]="invoices()?.page ?? 1" [totalPages]="invoices()?.totalPages ?? 1" [total]="invoices()?.total ?? 0" (go)="loadInvoices($event)" />
    }`,
})
export class BillingPage implements OnInit {
  s = inject(AdminSession); private api = inject(Api); private toast = inject(Toast);
  b = signal<any>(null); invoices = signal<OffsetPage<any> | null>(null); themes = signal<any[]>([]); requests = signal<any[]>([]);
  cycle: 'MONTHLY' | 'YEARLY' = 'MONTHLY';
  req: any = { requestType: 'STORE_SETUP', title: '', description: '' };
  ngOnInit() { this.load(); }
  async load() {
    const [b, t, r] = await Promise.all([this.api.get('/api/admin/billing'), this.api.get('/api/admin/theme').catch(() => ({ themes: [] })),
      this.api.get('/api/admin/billing/service-requests').catch(() => ({ items: [] }))]);
    this.b.set(b); this.cycle = b.subscription?.billing_cycle ?? 'MONTHLY';
    this.themes.set(t.themes.filter((x: any) => x.isPremium && !x.exclusive)); this.requests.set(r.items);
    this.loadInvoices(1);
  }
  async loadInvoices(p: number) { this.invoices.set(await this.api.get('/api/admin/billing/invoices', { page: p })); }
  async pay(invoiceId: number) {
    try {
      const r = await this.api.post(`/api/admin/billing/invoices/${invoiceId}/pay`);
      const res = await openRazorpay({ key: r.keyId, orderId: r.razorpayOrderId, amount: r.amount, name: 'Subscription', description: r.invoiceNumber });
      await this.api.post('/api/admin/billing/verify-payment', res);
      this.toast.ok('Payment successful. Thank you!');
      await this.s.load(); this.load();
    } catch (e: any) { this.toast.err(errMsg(e)); }
  }
  async changePlan(code: string) {
    try { const inv = await this.api.post('/api/admin/billing/change-plan', { planCode: code, billingCycle: this.cycle }); this.toast.ok(`Invoice ${inv.invoiceNumber} created`); await this.pay(inv.id); }
    catch (e) { this.toast.err(errMsg(e)); this.load(); }
  }
  async buyAddon(code: string) { try { const inv = await this.api.post(`/api/admin/billing/addons/${code}`); await this.pay(inv.id); } catch (e) { this.toast.err(errMsg(e)); this.load(); } }
  async cancelAddon(code: string) { await this.api.post(`/api/admin/billing/addons/${code}/cancel`); this.toast.ok('Add-on will not renew'); this.load(); }
  async buyTheme(id: number) { try { const inv = await this.api.post(`/api/admin/billing/themes/${id}/purchase`); await this.pay(inv.id); } catch (e) { this.toast.err(errMsg(e)); this.load(); } }
  async autoRenew(v: boolean) { await this.api.put('/api/admin/billing/auto-renew', { autoRenew: v }); this.toast.ok('Updated'); }
  async request() {
    try { const r = await this.api.post('/api/admin/billing/service-requests', this.req); this.toast.ok('Request sent');
      if (r.invoice) await this.pay(r.invoice.id); this.req = { requestType: 'STORE_SETUP', title: '', description: '' }; this.load(); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
}

/** Printable GST invoice */
@Component({
  selector: 'sa-invoice',
  imports: [DatePipe, InrPipe, RouterLink, BadgeComponent],
  template: `
    @if (i(); as i) {
      <div class="page-head no-print"><a routerLink="/admin/billing" class="btn sm">‹ Billing</a><span class="spacer"></span><button class="btn" (click)="print()"><span class="mi">print</span> Print / PDF</button></div>
      <div class="card" style="max-width:800px;margin:auto">
        <div class="row between"><div><h2>TAX INVOICE</h2><b>{{ i.seller.name }}</b><br />{{ i.seller.address }}<br />GSTIN: {{ i.seller.gstin || '—' }}</div>
          <div style="text-align:right"><b>{{ i.invoice_number }}</b><br />Date: {{ i.issued_at | date: 'mediumDate' }}<br /><ms-badge [value]="i.status" /></div></div>
        <hr /><p><b>Bill to:</b> {{ i.bill_to_name }}<br />{{ i.bill_to_address }}<br />GSTIN: {{ i.bill_to_gstin || 'Unregistered' }} · Place of supply: {{ i.place_of_supply }}</p>
        <table class="table"><tr><th>Description</th><th>SAC</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr>
          @for (it of i.items; track it.id) { <tr><td>{{ it.description }}</td><td>{{ it.sac_code }}</td><td class="num">{{ it.quantity }}</td><td class="num">{{ it.unit_price | inr }}</td><td class="num">{{ it.amount | inr }}</td></tr> }
          <tr><td colspan="4" class="num">Taxable value</td><td class="num">{{ i.subtotal | inr }}</td></tr>
          @if (i.cgst_amount > 0) { <tr><td colspan="4" class="num">CGST {{ i.cgst_rate }}%</td><td class="num">{{ i.cgst_amount | inr }}</td></tr>
            <tr><td colspan="4" class="num">SGST {{ i.sgst_rate }}%</td><td class="num">{{ i.sgst_amount | inr }}</td></tr> }
          @if (i.igst_amount > 0) { <tr><td colspan="4" class="num">IGST {{ i.igst_rate }}%</td><td class="num">{{ i.igst_amount | inr }}</td></tr> }
          <tr><td colspan="4" class="num"><b>Total</b></td><td class="num"><b>{{ i.total | inr }}</b></td></tr></table>
      </div>
    }`,
})
export class InvoicePage implements OnInit {
  id = input.required<string>(); i = signal<any>(null);
  private api = inject(Api);
  async ngOnInit() { this.i.set(await this.api.get(`/api/admin/billing/invoices/${this.id()}`)); }
  print() { window.print(); }
}
