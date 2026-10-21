import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe, JsonPipe } from '@angular/common';
import { Api, OffsetPage, errMsg } from '../../shared/api.service';
import { BadgeComponent, InrPipe, PagerComponent, Toast } from '../../shared/ui';
import { hostUrl, storeHost } from '../../shared/app-mode';

const COMMON = [RouterLink, FormsModule, DatePipe, InrPipe, BadgeComponent, PagerComponent];

// ------------------------------------------------------------------ dashboard
@Component({
  selector: 'pf-dash', imports: COMMON,
  template: `
    <div class="page-head"><h1>Platform dashboard</h1></div>
    @if (d(); as d) {
      <div class="grid c4">
        <div class="card"><div class="muted">MRR</div><div class="stat">{{ d.mrr | inr }}</div></div>
        <div class="card"><div class="muted">Revenue this month</div><div class="stat">{{ d.revenueThisMonth | inr }}</div></div>
        <div class="card"><div class="muted">New stores this month</div><div class="stat">{{ d.newThisMonth }}</div></div>
        <div class="card"><div class="muted">Unpaid invoices</div><div class="stat">{{ d.unpaidInvoices.count }}</div>{{ d.unpaidInvoices.amount | inr }}</div>
      </div>
      <div class="grid c2 mt">
        <div class="card"><h3>Stores by status</h3>@for (s of d.byStatus; track s.status) { <div class="row between"><ms-badge [value]="s.status" /><b>{{ s.n }}</b></div> }</div>
        <div class="card"><h3>Stores by plan</h3>@for (s of d.byPlan; track s.name) { <div class="row between"><span>{{ s.name }}</span><b>{{ s.n }}</b></div> }</div>
      </div>
    }`,
})
export class PfDashboard implements OnInit {
  d = signal<any>(null); private api = inject(Api);
  async ngOnInit() { this.d.set(await this.api.get('/api/platform/dashboard')); }
}

// ------------------------------------------------------------------ tenants (100+ clients, one list — PDF §7)
@Component({
  selector: 'pf-tenants', imports: COMMON,
  template: `
    <div class="page-head"><h1>Clients</h1></div>
    <div class="filters">
      <input placeholder="Name, subdomain, email, mobile" [(ngModel)]="q" (keyup.enter)="load(1)" />
      <select [(ngModel)]="status" (change)="load(1)"><option value="">All status</option>@for (s of statuses; track s) { <option>{{ s }}</option> }</select>
      <select [(ngModel)]="plan" (change)="load(1)"><option value="">All plans</option><option>BASIC</option><option>PRO</option><option>BUSINESS</option></select>
    </div>
    <div class="card" style="padding:0"><table class="table">
      <tr><th>Store</th><th>Owner</th><th>Plan</th><th>Status</th><th>Renews</th><th>Joined</th></tr>
      @for (t of page()?.items; track t.id) {
        <tr><td><a [routerLink]="['/tenants', t.id]"><b>{{ t.name }}</b></a><br /><small class="muted">{{ t.subdomain }}</small></td>
          <td>{{ t.owner_name }}<br /><small class="muted">{{ t.owner_email }} · {{ t.owner_mobile }}</small></td>
          <td>{{ t.plan_name }}</td><td><ms-badge [value]="t.status" /></td><td>{{ t.current_period_end | date: 'mediumDate' }}</td><td>{{ t.created_at | date: 'mediumDate' }}</td></tr>
      }
    </table></div>
    <ms-pager [page]="page()?.page ?? 1" [totalPages]="page()?.totalPages ?? 1" [total]="page()?.total ?? 0" (go)="load($event)" />`,
})
export class PfTenants implements OnInit {
  statuses = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'PENDING_PAYMENT', 'CANCELLED'];
  page = signal<OffsetPage<any> | null>(null); q = ''; status = ''; plan = '';
  private api = inject(Api);
  ngOnInit() { this.load(1); }
  async load(p: number) { this.page.set(await this.api.get('/api/platform/tenants', { page: p, q: this.q, status: this.status, plan: this.plan })); }
}

/** One client: plan, module on/off, limits, subscription, suspend, impersonate (PDF §3 step 9) */
@Component({
  selector: 'pf-tenant', imports: COMMON,
  template: `
    @if (t(); as t) {
      <div class="page-head"><a routerLink="/tenants" class="btn sm">‹ Clients</a><h1>{{ t.name }}</h1><ms-badge [value]="t.status" /><span class="spacer"></span>
        <a class="btn" [href]="storeUrl(t.subdomain)" target="_blank">Open store</a>
        <button class="btn" (click)="impersonate()"><span class="mi">support_agent</span> Login as owner</button>
        @if (t.status === 'SUSPENDED') { <button class="btn primary" (click)="resume()">Resume store</button> } @else { <button class="btn danger" (click)="suspend()">Suspend</button> }
      </div>
      @if (t.suspended_reason) { <div class="alert err mb">Suspended: {{ t.suspended_reason }}</div> }
      <div class="grid c3">
        <div class="card"><h3>Owner</h3><p>{{ t.owner_name }}<br />{{ t.owner_email }}<br />{{ t.owner_mobile }}</p>
          <p class="muted">Products {{ t.counts.products }} · Orders {{ t.counts.orders }} · Customers {{ t.counts.customers }} · Users {{ t.counts.users }}</p></div>
        <div class="card stack"><h3>Plan & subscription</h3>
          <select [(ngModel)]="planCode">@for (p of plans(); track p.code) { <option [value]="p.code">{{ p.name }}</option> }</select>
          <button class="btn" (click)="changePlan()">Change plan (no invoice)</button>
          @if (t.subscription) { <p>{{ t.subscription.billing_cycle }} · <ms-badge [value]="t.subscription.status" /><br />Period ends {{ t.subscription.current_period_end | date: 'medium' }}
            @if (t.subscription.grace_until) { <br />Grace until {{ t.subscription.grace_until | date: 'medium' }} } </p> }
          <div class="row"><input type="number" [(ngModel)]="extendDays" style="width:90px" /><button class="btn sm" (click)="extend()">Extend days</button></div>
        </div>
        <div class="card stack"><h3>Limits (empty = plan default)</h3>
          <label class="field"><span>Max products (plan {{ t.plan.max_products ?? '∞' }})</span><input type="number" [(ngModel)]="limits.maxProducts" /></label>
          <label class="field"><span>Max staff (plan {{ t.plan.max_staff ?? '∞' }})</span><input type="number" [(ngModel)]="limits.maxStaff" /></label>
          <label class="field"><span>Max storage MB (plan {{ t.plan.max_storage_mb ?? '∞' }})</span><input type="number" [(ngModel)]="limits.maxStorageMb" /></label>
          <button class="btn" (click)="saveLimits()">Save limits</button></div>
      </div>
      <div class="grid c2 mt">
        <div class="card"><h3>Modules (on / off)</h3>
          <table class="table">@for (m of t.modules; track m.id) {
            <tr><td>{{ m.name }} @if (m.is_core) { <small class="muted">core</small> }</td><td><small class="muted">{{ m.source }}</small></td>
              <td><label class="check"><input type="checkbox" [checked]="m.is_core || m.is_enabled" [disabled]="m.is_core" (change)="toggleModule(m, $any($event.target).checked)" /> On</label></td></tr>
          }</table></div>
        <div class="stack">
          <div class="card"><h3>Domains</h3>@for (d of t.domains; track d.id) { <div class="row between"><span>{{ d.domain }}</span><ms-badge [value]="d.verification_status" /></div> }</div>
          <div class="card stack"><h3>Invoices</h3>
            @for (i of t.invoices; track i.id) { <div class="row between"><span>{{ i.invoice_number }}</span><span>{{ i.total | inr }}</span><ms-badge [value]="i.status" />
              @if (i.status === 'ISSUED') { <button class="btn sm" (click)="markPaid(i.id)">Mark paid</button> }</div> }
            <h3>Raise invoice (custom design etc.)</h3>
            <div class="row"><input [(ngModel)]="inv.description" placeholder="Description" /><input type="number" [(ngModel)]="inv.amount" placeholder="₹" style="width:100px" />
              <select [(ngModel)]="inv.type" style="width:auto"><option>CUSTOM_DESIGN</option><option>SETUP</option><option>OTHER</option></select>
              <button class="btn sm primary" (click)="raise()">Create</button></div>
          </div>
        </div>
      </div>
    }`,
})
export class PfTenantDetail implements OnInit {
  id = input.required<string>();
  t = signal<any>(null); plans = signal<any[]>([]);
  planCode = ''; extendDays = 7; limits: any = {}; inv: any = { description: '', amount: null, type: 'CUSTOM_DESIGN' };
  private api = inject(Api); private toast = inject(Toast);
  storeUrl = (sub: string) => hostUrl(storeHost(sub));
  async ngOnInit() { this.plans.set(await this.api.get('/api/platform/plans')); this.load(); }
  async load() {
    const t = await this.api.get(`/api/platform/tenants/${this.id()}`);
    this.t.set(t); this.planCode = t.plan.code;
    this.limits = { maxProducts: t.limits?.max_products ?? null, maxStaff: t.limits?.max_staff ?? null, maxStorageMb: t.limits?.max_storage_mb ?? null };
  }
  private async run(fn: () => Promise<any>, msg: string) { try { await fn(); this.toast.ok(msg); this.load(); } catch (e) { this.toast.err(errMsg(e)); } }
  changePlan() { this.run(() => this.api.put(`/api/platform/tenants/${this.id()}/plan`, { planCode: this.planCode }), 'Plan changed'); }
  extend() { this.run(() => this.api.post(`/api/platform/tenants/${this.id()}/extend`, { days: Number(this.extendDays) }), 'Extended'); }
  toggleModule(m: any, on: boolean) { this.run(() => this.api.put(`/api/platform/tenants/${this.id()}/modules`, { modules: [{ code: m.code, enabled: on }] }), `${m.name} ${on ? 'enabled' : 'disabled'}`); }
  saveLimits() {
    const n = (v: any) => (v === null || v === '' ? null : Number(v));
    this.run(() => this.api.put(`/api/platform/tenants/${this.id()}/limits`, { maxProducts: n(this.limits.maxProducts), maxStaff: n(this.limits.maxStaff), maxStorageMb: n(this.limits.maxStorageMb) }), 'Limits saved');
  }
  suspend() { const reason = prompt('Reason for suspension?', 'Payment overdue'); if (reason) this.run(() => this.api.post(`/api/platform/tenants/${this.id()}/suspend`, { reason }), 'Store suspended'); }
  resume() { this.run(() => this.api.post(`/api/platform/tenants/${this.id()}/resume`), 'Store resumed'); }
  markPaid(id: number) { this.run(() => this.api.post(`/api/platform/invoices/${id}/mark-paid`), 'Marked paid'); }
  raise() { this.run(() => this.api.post(`/api/platform/tenants/${this.id()}/invoices`, { type: this.inv.type, items: [{ description: this.inv.description, unitPrice: Number(this.inv.amount), quantity: 1 }] }), 'Invoice created'); }
  async impersonate() {
    const reason = prompt('Reason (recorded in audit log)?', 'Support request');
    if (!reason) return;
    try { const r = await this.api.post(`/api/platform/tenants/${this.id()}/impersonate`, { reason }); window.open(r.url, '_blank'); } catch (e) { this.toast.err(errMsg(e)); }
  }
}

// ------------------------------------------------------------------ plans
@Component({
  selector: 'pf-plans', imports: COMMON,
  template: `
    <div class="page-head"><h1>Plans</h1><span class="spacer"></span><button class="btn primary" (click)="edit(null)">New plan</button></div>
    <div class="card" style="padding:0"><table class="table">
      <tr><th>Plan</th><th class="num">Monthly</th><th class="num">Yearly</th><th>Limits</th><th>Fee</th><th>Modules</th><th class="num">Stores</th><th></th></tr>
      @for (p of plans(); track p.id) {
        <tr><td><b>{{ p.name }}</b> <small class="muted">{{ p.code }}</small>@if (!p.is_active) { <span class="badge">inactive</span> }</td>
          <td class="num">{{ p.price_monthly | inr }}</td><td class="num">{{ p.price_yearly | inr }}</td>
          <td><small>{{ p.max_products ?? '∞' }} products · {{ p.max_staff ?? '∞' }} staff · {{ p.max_storage_mb ?? '∞' }} MB</small></td>
          <td>{{ p.transaction_fee_percent }}%</td><td><small>{{ p.modules.join(', ') }}</small></td><td class="num">{{ p.tenantCount }}</td>
          <td><button class="btn sm" (click)="edit(p)">Edit</button></td></tr>
      }
    </table></div>
    @if (f) {
      <form class="card stack mt" (ngSubmit)="save()" style="max-width:820px">
        <div class="grid c3"><label class="field"><span>Code</span><input [(ngModel)]="f.code" name="c" /></label><label class="field"><span>Name</span><input [(ngModel)]="f.name" name="n" /></label>
          <label class="field"><span>Trial days</span><input type="number" [(ngModel)]="f.trialDays" name="td" /></label></div>
        <label class="field"><span>Description</span><input [(ngModel)]="f.description" name="d" /></label>
        <div class="grid c3"><label class="field"><span>Price / month</span><input type="number" [(ngModel)]="f.priceMonthly" name="pm" /></label>
          <label class="field"><span>Price / year</span><input type="number" [(ngModel)]="f.priceYearly" name="py" /></label>
          <label class="field"><span>Txn fee %</span><input type="number" step="0.1" [(ngModel)]="f.transactionFeePercent" name="tf" /></label></div>
        <div class="grid c3"><label class="field"><span>Max products</span><input type="number" [(ngModel)]="f.maxProducts" name="mp" /></label>
          <label class="field"><span>Max staff</span><input type="number" [(ngModel)]="f.maxStaff" name="ms" /></label>
          <label class="field"><span>Max storage MB</span><input type="number" [(ngModel)]="f.maxStorageMb" name="mm" /></label></div>
        <div class="row"><label class="check"><input type="checkbox" [(ngModel)]="f.allowCustomDomain" name="cd" /> Custom domain</label>
          <label class="check"><input type="checkbox" [(ngModel)]="f.allowHeadlessApi" name="ha" /> Headless API</label>
          <label class="check"><input type="checkbox" [(ngModel)]="f.isPublic" name="ip" /> Public</label><label class="check"><input type="checkbox" [(ngModel)]="f.isActive" name="ia" /> Active</label></div>
        <b>Modules in plan</b><div class="row">@for (m of modules(); track m.code) { <label class="check"><input type="checkbox" [checked]="f.modules.includes(m.code)" (change)="toggle(m.code)" /> {{ m.name }}</label> }</div>
        <div class="row"><button class="btn primary">Save plan</button><button type="button" class="btn" (click)="f = null">Cancel</button></div>
      </form>
    }`,
})
export class PfPlans implements OnInit {
  plans = signal<any[]>([]); modules = signal<any[]>([]); f: any = null;
  private api = inject(Api); private toast = inject(Toast);
  async ngOnInit() { this.load(); this.modules.set(await this.api.get('/api/platform/modules')); }
  async load() { this.plans.set(await this.api.get('/api/platform/plans')); }
  edit(p: any) {
    this.f = p ? { id: p.id, code: p.code, name: p.name, description: p.description, priceMonthly: p.price_monthly, priceYearly: p.price_yearly, trialDays: p.trial_days,
      maxProducts: p.max_products, maxStaff: p.max_staff, maxStorageMb: p.max_storage_mb, allowCustomDomain: p.allow_custom_domain, allowHeadlessApi: p.allow_headless_api,
      transactionFeePercent: p.transaction_fee_percent, isPublic: p.is_public, isActive: p.is_active, sortOrder: p.sort_order, modules: [...p.modules] }
      : { code: '', name: '', description: '', priceMonthly: 0, priceYearly: 0, trialDays: 14, maxProducts: null, maxStaff: null, maxStorageMb: null, allowCustomDomain: false,
        allowHeadlessApi: false, transactionFeePercent: 0, isPublic: true, isActive: true, sortOrder: 0, modules: ['CATALOG', 'ORDERS', 'CUSTOMERS', 'ACCESS', 'THEME'] };
  }
  toggle(c: string) { const i = this.f.modules.indexOf(c); i >= 0 ? this.f.modules.splice(i, 1) : this.f.modules.push(c); }
  async save() {
    const n = (v: any) => (v === null || v === '' ? null : Number(v));
    const { id, ...b } = this.f;
    const body = { ...b, priceMonthly: Number(b.priceMonthly), priceYearly: Number(b.priceYearly), trialDays: Number(b.trialDays), maxProducts: n(b.maxProducts),
      maxStaff: n(b.maxStaff), maxStorageMb: n(b.maxStorageMb), transactionFeePercent: Number(b.transactionFeePercent), sortOrder: Number(b.sortOrder || 0) };
    try { if (id) await this.api.put(`/api/platform/plans/${id}`, body); else await this.api.post('/api/platform/plans', body); this.f = null; this.load(); this.toast.ok('Saved'); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
}

// ------------------------------------------------------------------ modules
@Component({
  selector: 'pf-modules', imports: COMMON,
  template: `
    <div class="page-head"><h1>Modules & add-ons</h1></div>
    <div class="card" style="padding:0"><table class="table">
      <tr><th>Code</th><th>Name</th><th>Description</th><th>Add-on</th><th>₹/month</th><th>Active</th><th></th></tr>
      @for (m of list(); track m.id) {
        <tr><td><code>{{ m.code }}</code>@if (m.is_core) { <small class="muted"> core</small> }</td><td><input [(ngModel)]="m.name" /></td><td><input [(ngModel)]="m.description" /></td>
          <td><input type="checkbox" [(ngModel)]="m.is_addon" /></td><td><input type="number" [(ngModel)]="m.addon_price_monthly" style="width:90px" /></td>
          <td><input type="checkbox" [(ngModel)]="m.is_active" /></td><td><button class="btn sm" (click)="save(m)">Save</button></td></tr>
      }
    </table></div>`,
})
export class PfModules implements OnInit {
  list = signal<any[]>([]); private api = inject(Api); private toast = inject(Toast);
  async ngOnInit() { this.list.set(await this.api.get('/api/platform/modules')); }
  async save(m: any) {
    await this.api.put(`/api/platform/modules/${m.id}`, { name: m.name, description: m.description, isAddon: !!m.is_addon, addonPriceMonthly: Number(m.addon_price_monthly), isActive: !!m.is_active });
    this.toast.ok('Saved');
  }
}

// ------------------------------------------------------------------ themes (incl. exclusive, PDF §9)
@Component({
  selector: 'pf-themes', imports: COMMON,
  template: `
    <div class="page-head"><h1>Themes</h1><span class="spacer"></span><button class="btn primary" (click)="edit(null)">New theme</button></div>
    <p class="muted">The theme <b>code</b> must match a layout registered in the Angular app (storefront/themes). Exclusive themes have an owner store.</p>
    <div class="card" style="padding:0"><table class="table">
      <tr><th>Code</th><th>Name</th><th>Premium</th><th>Exclusive to</th><th>Active</th><th></th></tr>
      @for (t of list(); track t.id) { <tr><td><code>{{ t.code }}</code></td><td>{{ t.name }}</td><td>{{ t.is_premium ? (t.price | inr) : 'Free' }}</td>
        <td>{{ t.owner_tenant_name || '—' }}</td><td>{{ t.is_active ? 'Yes' : 'No' }}</td><td><button class="btn sm" (click)="edit(t)">Edit</button></td></tr> }
    </table></div>
    @if (f) {
      <form class="card stack mt" (ngSubmit)="save()">
        <div class="grid c3"><label class="field"><span>Code</span><input [(ngModel)]="f.code" name="c" /></label><label class="field"><span>Name</span><input [(ngModel)]="f.name" name="n" /></label>
          <label class="field"><span>Exclusive owner store ID</span><input type="number" [(ngModel)]="f.ownerTenantId" name="o" /></label></div>
        <label class="field"><span>Description</span><input [(ngModel)]="f.description" name="d" /></label>
        <div class="row"><label class="check"><input type="checkbox" [(ngModel)]="f.isPremium" name="p" /> Premium</label><input type="number" [(ngModel)]="f.price" name="pr" style="width:120px" placeholder="Price" />
          <label class="check"><input type="checkbox" [(ngModel)]="f.isActive" name="a" /> Active</label></div>
        <label class="field"><span>Default settings (JSON)</span><textarea rows="6" [(ngModel)]="f.settingsJson" name="s"></textarea></label>
        <label class="field"><span>Default sections (JSON)</span><textarea rows="8" [(ngModel)]="f.sectionsJson" name="se"></textarea></label>
        <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" (click)="f = null">Cancel</button></div>
      </form>
    }`,
})
export class PfThemes implements OnInit {
  list = signal<any[]>([]); f: any = null; private api = inject(Api); private toast = inject(Toast);
  ngOnInit() { this.load(); }
  async load() { this.list.set(await this.api.get('/api/platform/themes')); }
  edit(t: any) {
    const base = this.list().find((x) => x.code === 'classic');
    this.f = { id: t?.id, code: t?.code ?? '', name: t?.name ?? '', description: t?.description ?? '', isPremium: t?.is_premium ?? false, price: t?.price ?? 0,
      ownerTenantId: t?.owner_tenant_id ?? null, isActive: t?.is_active ?? true, sortOrder: t?.sort_order ?? 0,
      settingsJson: JSON.stringify(t?.default_settings ?? base?.default_settings ?? {}, null, 2), sectionsJson: JSON.stringify(t?.default_sections ?? base?.default_sections ?? [], null, 2) };
  }
  async save() {
    try {
      const { id, settingsJson, sectionsJson, ...b } = this.f;
      const body = { ...b, price: Number(b.price), ownerTenantId: b.ownerTenantId ? Number(b.ownerTenantId) : null, previewImageUrl: null,
        defaultSettings: JSON.parse(settingsJson), defaultSections: JSON.parse(sectionsJson) };
      if (id) await this.api.put(`/api/platform/themes/${id}`, body); else await this.api.post('/api/platform/themes', body);
      this.f = null; this.load(); this.toast.ok('Saved');
    } catch (e) { this.toast.err(errMsg(e)); }
  }
}

// ------------------------------------------------------------------ global permissions (PDF §5.1)
@Component({
  selector: 'pf-perms', imports: COMMON,
  template: `
    <div class="page-head"><h1>Permissions (global list)</h1></div>
    <p class="muted">Backend code checks only these codes. Clients build their own roles from this list.</p>
    <div class="card row mb"><input [(ngModel)]="n.code" placeholder="CODE_NAME" style="width:200px" /><input [(ngModel)]="n.name" placeholder="Name" />
      <input [(ngModel)]="n.groupName" placeholder="Group" style="width:140px" /><input [(ngModel)]="n.moduleCode" placeholder="Module (optional)" style="width:160px" /><button class="btn primary" (click)="add()">Add</button></div>
    <div class="card" style="padding:0"><table class="table">
      <tr><th>Code</th><th>Name</th><th>Group</th><th>Module</th></tr>
      @for (p of list(); track p.id) { <tr><td><code>{{ p.code }}</code></td><td>{{ p.name }}</td><td>{{ p.group_name }}</td><td>{{ p.module_code }}</td></tr> }
    </table></div>`,
})
export class PfPermissions implements OnInit {
  list = signal<any[]>([]); n: any = { code: '', name: '', groupName: '', moduleCode: '' };
  private api = inject(Api); private toast = inject(Toast);
  ngOnInit() { this.load(); }
  async load() { this.list.set(await this.api.get('/api/platform/permissions')); }
  async add() { try { await this.api.post('/api/platform/permissions', { ...this.n, moduleCode: this.n.moduleCode || null }); this.n = { code: '', name: '', groupName: '', moduleCode: '' }; this.load(); } catch (e) { this.toast.err(errMsg(e)); } }
}

// ------------------------------------------------------------------ subscriptions
@Component({
  selector: 'pf-subs', imports: COMMON,
  template: `
    <div class="page-head"><h1>Subscriptions</h1></div>
    <div class="filters"><select [(ngModel)]="status" (change)="load(1)"><option value="">All</option><option>TRIALING</option><option>ACTIVE</option><option>PAST_DUE</option><option>CANCELLED</option></select></div>
    <div class="card" style="padding:0"><table class="table">
      <tr><th>Store</th><th>Plan</th><th>Cycle</th><th class="num">Amount</th><th>Status</th><th>Period end</th><th>Auto-renew</th></tr>
      @for (s of page()?.items; track s.id) { <tr><td><a [routerLink]="['/tenants', s.tenant_id]">{{ s.tenant_name }}</a></td><td>{{ s.plan_name }}</td><td>{{ s.billing_cycle }}</td>
        <td class="num">{{ s.amount | inr }}</td><td><ms-badge [value]="s.status" /></td><td>{{ s.current_period_end | date: 'mediumDate' }}</td><td>{{ s.auto_renew ? 'Yes' : 'No' }}</td></tr> }
    </table></div>
    <ms-pager [page]="page()?.page ?? 1" [totalPages]="page()?.totalPages ?? 1" [total]="page()?.total ?? 0" (go)="load($event)" />`,
})
export class PfSubscriptions implements OnInit {
  page = signal<OffsetPage<any> | null>(null); status = ''; private api = inject(Api);
  ngOnInit() { this.load(1); }
  async load(p: number) { this.page.set(await this.api.get('/api/platform/subscriptions', { page: p, status: this.status })); }
}

// ------------------------------------------------------------------ invoices
@Component({
  selector: 'pf-invoices', imports: COMMON,
  template: `
    <div class="page-head"><h1>Invoices</h1></div>
    <div class="filters"><select [(ngModel)]="status" (change)="load(1)"><option value="">All</option><option>ISSUED</option><option>PAID</option><option>VOID</option></select></div>
    <div class="card" style="padding:0"><table class="table">
      <tr><th>Number</th><th>Store</th><th>Type</th><th class="num">Taxable</th><th class="num">GST</th><th class="num">Total</th><th>Status</th><th>Issued</th><th></th></tr>
      @for (i of page()?.items; track i.id) {
        <tr><td>{{ i.invoice_number }}</td><td><a [routerLink]="['/tenants', i.tenant_id]">{{ i.tenant_name }}</a></td><td>{{ i.invoice_type }}</td>
          <td class="num">{{ i.subtotal | inr }}</td><td class="num">{{ (+i.cgst_amount + +i.sgst_amount + +i.igst_amount) | inr }}</td><td class="num">{{ i.total | inr }}</td>
          <td><ms-badge [value]="i.status" /></td><td>{{ i.issued_at | date: 'mediumDate' }}</td>
          <td>@if (i.status === 'ISSUED') { <button class="btn sm" (click)="act(i, 'mark-paid')">Mark paid</button> <button class="btn sm danger" (click)="act(i, 'void')">Void</button> }</td></tr>
      }
    </table></div>
    <ms-pager [page]="page()?.page ?? 1" [totalPages]="page()?.totalPages ?? 1" [total]="page()?.total ?? 0" (go)="load($event)" />`,
})
export class PfInvoices implements OnInit {
  page = signal<OffsetPage<any> | null>(null); status = ''; private api = inject(Api); private toast = inject(Toast);
  ngOnInit() { this.load(1); }
  async load(p: number) { this.page.set(await this.api.get('/api/platform/invoices', { page: p, status: this.status })); }
  async act(i: any, a: string) { try { await this.api.post(`/api/platform/invoices/${i.id}/${a}`); this.toast.ok('Done'); this.load(this.page()!.page); } catch (e) { this.toast.err(errMsg(e)); } }
}

// ------------------------------------------------------------------ service requests (setup, custom design, custom module — PDF §9/§10)
@Component({
  selector: 'pf-sr', imports: COMMON,
  template: `
    <div class="page-head"><h1>Service requests</h1></div>
    <div class="card" style="padding:0"><table class="table">
      <tr><th>Store</th><th>Type</th><th>Request</th><th>Status</th><th>Quote ₹</th><th>Monthly add-on ₹</th><th></th></tr>
      @for (r of page()?.items; track r.id) {
        <tr><td>{{ r.tenant_name }}</td><td>{{ r.request_type }}</td><td><b>{{ r.title }}</b><br /><small class="muted">{{ r.description }}</small></td>
          <td><select [(ngModel)]="r.status">@for (s of statuses; track s) { <option>{{ s }}</option> }</select></td>
          <td><input type="number" [(ngModel)]="r.quoted_amount" style="width:100px" /></td><td><input type="number" [(ngModel)]="r.monthly_addon" style="width:100px" /></td>
          <td><button class="btn sm" (click)="save(r, false)">Save</button> @if (!r.invoice_id) { <button class="btn sm primary" (click)="save(r, true)">Save & invoice</button> }</td></tr>
      }
    </table></div>
    <ms-pager [page]="page()?.page ?? 1" [totalPages]="page()?.totalPages ?? 1" [total]="page()?.total ?? 0" (go)="load($event)" />`,
})
export class PfServiceRequests implements OnInit {
  statuses = ['NEW', 'QUOTED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'REJECTED'];
  page = signal<OffsetPage<any> | null>(null); private api = inject(Api); private toast = inject(Toast);
  ngOnInit() { this.load(1); }
  async load(p: number) { this.page.set(await this.api.get('/api/platform/service-requests', { page: p })); }
  async save(r: any, sendInvoice: boolean) {
    try { await this.api.put(`/api/platform/service-requests/${r.id}`, { status: r.status, quotedAmount: r.quoted_amount != null ? Number(r.quoted_amount) : undefined,
      monthlyAddon: r.monthly_addon != null && r.monthly_addon !== '' ? Number(r.monthly_addon) : null, sendInvoice }); this.toast.ok('Saved'); this.load(this.page()!.page); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
}

// ------------------------------------------------------------------ audit
@Component({
  selector: 'pf-audit', imports: [...COMMON, JsonPipe],
  template: `
    <div class="page-head"><h1>Audit log (all stores)</h1></div>
    <div class="filters"><input placeholder="Store ID" [(ngModel)]="tenantId" style="min-width:100px" (keyup.enter)="reload()" /><input placeholder="Action" [(ngModel)]="action" (keyup.enter)="reload()" /></div>
    <div class="card" style="padding:0"><table class="table">
      <tr><th>When</th><th>Store</th><th>Actor</th><th>Action</th><th>Entity</th><th></th></tr>
      @for (a of items(); track a.id) { <tr><td>{{ a.created_at | date: 'short' }}</td><td>{{ a.tenant_id }}</td><td>{{ a.actor_type }} {{ a.actor_id }}@if (a.impersonator_id) { (imp {{ a.impersonator_id }}) }</td>
        <td><code>{{ a.action }}</code></td><td>{{ a.entity_type }} {{ a.entity_id }}</td><td><details><summary>view</summary><pre>{{ a.new_values | json }}</pre></details></td></tr> }
    </table></div>
    @if (cursor()) { <div class="pager"><button class="btn" (click)="more()">Load more</button></div> }`,
})
export class PfAudit implements OnInit {
  items = signal<any[]>([]); cursor = signal<string | null>(null); tenantId = ''; action = '';
  private api = inject(Api);
  ngOnInit() { this.more(); }
  reload() { this.items.set([]); this.cursor.set(null); this.more(); }
  async more() {
    const r = await this.api.get('/api/platform/audit', { cursor: this.cursor() ?? undefined, tenantId: this.tenantId || undefined, action: this.action || undefined, size: 40 });
    this.items.update((l) => [...l, ...r.items]); this.cursor.set(r.nextCursor);
  }
}

// ------------------------------------------------------------------ settings & platform users
@Component({
  selector: 'pf-settings', imports: COMMON,
  template: `
    <div class="page-head"><h1>Platform settings</h1></div>
    <div class="grid c2" style="align-items:start">
      <div class="card stack">
        @for (s of settings(); track s.setting_key) { <label class="field"><span>{{ s.setting_key }}</span><input [(ngModel)]="s.setting_value" /></label> }
        <button class="btn primary" (click)="save()">Save settings</button>
      </div>
      <div class="card stack"><h3>Super admin users</h3>
        @for (u of users(); track u.id) { <div class="row between"><span>{{ u.name }} · {{ u.email }}</span><small class="muted">{{ u.last_login_at | date: 'short' }}</small></div> }
        <input [(ngModel)]="nu.name" placeholder="Name" /><input [(ngModel)]="nu.email" placeholder="Email" /><input [(ngModel)]="nu.password" type="password" placeholder="Password (min 10)" />
        <button class="btn" (click)="addUser()">Add admin</button>
      </div>
    </div>`,
})
export class PfSettings implements OnInit {
  settings = signal<any[]>([]); users = signal<any[]>([]); nu: any = { name: '', email: '', password: '' };
  private api = inject(Api); private toast = inject(Toast);
  async ngOnInit() { this.settings.set(await this.api.get('/api/platform/settings')); this.users.set(await this.api.get('/api/platform/platform-users')); }
  async save() { await this.api.put('/api/platform/settings', Object.fromEntries(this.settings().map((s) => [s.setting_key, s.setting_value ?? '']))); this.toast.ok('Saved'); }
  async addUser() { try { await this.api.post('/api/platform/platform-users', this.nu); this.nu = { name: '', email: '', password: '' }; this.ngOnInit(); } catch (e) { this.toast.err(errMsg(e)); } }
}
