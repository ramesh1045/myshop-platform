/**
 * Super Admin panel API (admin.myshop.com) — PDF §4: manages all clients, plans, themes,
 * permissions, subscriptions. PDF §3 step 9: plan, module on/off, limits, subscription status,
 * suspend store when unpaid. PDF §12 phase 5: impersonation.
 */
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '../../db/knex';
import { currentAuth, ctx } from '../../context/request-context';
import { body, rateLimit } from '../../middleware/common';
import { requireAuth } from '../../middleware/auth';
import { issueRefresh, revokeRefresh, rotateRefresh, signAccess } from '../../lib/jwt';
import { HttpError, badRequest, notFound } from '../../lib/http-error';
import { cursorPaginate, offsetPaginate } from '../../lib/pagination';
import { audit } from '../../lib/audit';
import { publicUrl, subdomainHost } from '../../config/env';
import { addDays } from '../../lib/util';
import { applyInvoicePaid, createInvoice, invalidateTenant, syncPlanModules } from '../../services/billing.service';
import { invalidateAcl } from '../../services/access.service';
import { sendEmail } from '../../lib/queue';
import { invalidate } from '../../cache/cache';

export const platformRouter = Router();

// ------------------------------------------------------------------ auth
platformRouter.post('/auth/login', rateLimit('pf-login', 10, 60), body(z.object({ email: z.string().email(), password: z.string() })), async (req, res) => {
  const u = await db('platform_users').where({ email: req.body.email.toLowerCase(), is_active: 1 }).first();
  if (!u || !(await bcrypt.compare(req.body.password, u.password_hash))) throw new HttpError(401, 'BAD_CREDENTIALS', 'Wrong email or password');
  await db('platform_users').where({ id: u.id }).update({ last_login_at: new Date() });
  ctx()!.auth = { type: 'PLATFORM', id: u.id };
  await audit('PLATFORM_LOGIN', 'platform_user', u.id, null, null, undefined, null);
  res.json({
    accessToken: signAccess({ sub: String(u.id), typ: 'PLATFORM' }),
    refreshToken: await issueRefresh('PLATFORM', u.id, null, ctx()?.ip),
  });
});
platformRouter.post('/auth/refresh', body(z.object({ refreshToken: z.string() })), async (req, res) => {
  const r = await rotateRefresh(req.body.refreshToken, 'PLATFORM', null);
  if (!r) throw new HttpError(401, 'REFRESH_INVALID', 'Please login again');
  res.json({ accessToken: signAccess({ sub: String(r.subjectId), typ: 'PLATFORM' }), refreshToken: r.newToken });
});
platformRouter.post('/auth/logout', body(z.object({ refreshToken: z.string() })), async (req, res) => {
  await revokeRefresh(req.body.refreshToken);
  res.status(204).end();
});

platformRouter.use(requireAuth('PLATFORM'));

platformRouter.get('/me', async (_req, res) => {
  res.json(await db('platform_users').where({ id: currentAuth().id }).first('id', 'name', 'email'));
});

// ------------------------------------------------------------------ dashboard
platformRouter.get('/dashboard', async (_req, res) => {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [byStatus, mrr, newThisMonth, unpaid, revenueMonth, byPlan] = await Promise.all([
    db('tenants').select('status').count({ n: '*' }).groupBy('status'),
    db('subscriptions').where({ is_current: 1, status: 'ACTIVE' })
      .sum({ s: db.raw("CASE WHEN billing_cycle = 'YEARLY' THEN amount / 12 ELSE amount END") }).first(),
    db('tenants').where('created_at', '>=', monthStart).count({ n: '*' }).first(),
    db('platform_invoices').where({ status: 'ISSUED' }).count({ n: '*' }).sum({ s: 'total' }).first(),
    db('platform_invoices').where({ status: 'PAID' }).where('paid_at', '>=', monthStart).sum({ s: 'total' }).first(),
    db('tenants as t').join('plans as p', 'p.id', 't.plan_id').select('p.name').count({ n: '*' }).groupBy('p.name'),
  ]);
  res.json({ byStatus, mrr: Number((mrr as any)?.s || 0), newThisMonth: Number((newThisMonth as any).n),
    unpaidInvoices: { count: Number((unpaid as any).n), amount: Number((unpaid as any).s || 0) },
    revenueThisMonth: Number((revenueMonth as any)?.s || 0), byPlan });
});

// ------------------------------------------------------------------ tenants (clients)
platformRouter.get('/tenants', async (req, res) => {
  const q = db('tenants as t').join('plans as p', 'p.id', 't.plan_id')
    .leftJoin('subscriptions as s', function () { this.on('s.tenant_id', '=', 't.id').andOn('s.is_current', '=', db.raw('1')); })
    .select('t.id', 't.name', 't.subdomain', 't.owner_name', 't.owner_email', 't.owner_mobile', 't.status', 't.created_at',
      't.trial_ends_at', 'p.code as plan_code', 'p.name as plan_name', 's.current_period_end', 's.status as subscription_status');
  if (req.query.status) q.where('t.status', String(req.query.status));
  if (req.query.plan) q.where('p.code', String(req.query.plan));
  if (req.query.q) {
    const s = `%${req.query.q}%`;
    q.where((w) => w.where('t.name', 'like', s).orWhere('t.subdomain', 'like', s).orWhere('t.owner_email', 'like', s).orWhere('t.owner_mobile', 'like', s));
  }
  res.json(await offsetPaginate(q, req, [{ column: 't.created_at', order: 'desc' }]));
});

platformRouter.get('/tenants/:id', async (req, res) => {
  const id = Number(req.params.id);
  const t = await db('tenants').where({ id }).first();
  if (!t) throw notFound('Tenant');
  const [plan, sub, limits, modules, domains, counts, invoices, owner] = await Promise.all([
    db('plans').where({ id: t.plan_id }).first(),
    db('subscriptions').where({ tenant_id: id, is_current: 1 }).first(),
    db('tenant_limits').where({ tenant_id: id }).first(),
    db('modules as m').leftJoin('tenant_modules as tm', function () { this.on('tm.module_id', '=', 'm.id').andOn('tm.tenant_id', '=', db.raw('?', [id])); })
      .select('m.id', 'm.code', 'm.name', 'm.is_core', 'm.is_addon', 'tm.is_enabled', 'tm.source', 'tm.expires_at').orderBy('m.sort_order'),
    db('tenant_domains').where({ tenant_id: id }),
    Promise.all(['products', 'orders', 'customers', 'users'].map((tb) => db(tb).where({ tenant_id: id }).count({ n: '*' }).first())),
    db('platform_invoices').where({ tenant_id: id }).orderBy('id', 'desc').limit(20),
    db('users').where({ tenant_id: id, is_owner: 1 }).first('id', 'name', 'email'),
  ]);
  res.json({ ...t, plan, subscription: sub, limits, modules, domains, owner, invoices,
    counts: { products: Number((counts[0] as any).n), orders: Number((counts[1] as any).n), customers: Number((counts[2] as any).n), users: Number((counts[3] as any).n) } });
});

platformRouter.put('/tenants/:id/plan', body(z.object({ planCode: z.string(), billingCycle: z.enum(['MONTHLY', 'YEARLY']).optional(), resetPeriod: z.boolean().default(false) })), async (req, res) => {
  const id = Number(req.params.id);
  const plan = await db('plans').where({ code: req.body.planCode }).first();
  if (!plan) throw badRequest('Invalid plan');
  await db.transaction(async (trx) => {
    await trx('tenants').where({ id }).update({ plan_id: plan.id });
    const patch: any = { plan_id: plan.id };
    if (req.body.billingCycle) patch.billing_cycle = req.body.billingCycle;
    patch.amount = (req.body.billingCycle ?? 'MONTHLY') === 'YEARLY' ? plan.price_yearly : plan.price_monthly;
    await trx('subscriptions').where({ tenant_id: id, is_current: 1 }).update(patch);
    await syncPlanModules(id, plan.id, trx);
  });
  await invalidateTenant(id);
  await invalidateAcl(id);
  await audit('TENANT_PLAN_CHANGE', 'tenant', id, null, req.body, undefined, id);
  res.json({ ok: true });
});

/** Module on/off per client (PDF §3 step 9, §9 tenant_modules) */
platformRouter.put('/tenants/:id/modules', body(z.object({
  modules: z.array(z.object({ code: z.string(), enabled: z.boolean(), expiresAt: z.coerce.date().nullable().optional() })),
})), async (req, res) => {
  const id = Number(req.params.id);
  const all = await db('modules').select('id', 'code', 'is_core');
  await db.transaction(async (trx) => {
    for (const m of req.body.modules) {
      const mod = all.find((x) => x.code === m.code);
      if (!mod) throw badRequest(`Unknown module ${m.code}`);
      if (mod.is_core && !m.enabled) throw badRequest(`${m.code} is a core module`);
      await trx.raw(
        `INSERT INTO tenant_modules (tenant_id, module_id, is_enabled, source, expires_at) VALUES (?, ?, ?, 'MANUAL', ?)
         ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), expires_at = VALUES(expires_at),
           source = IF(source = 'PLAN' AND VALUES(is_enabled) = 1, 'PLAN', 'MANUAL')`,
        [id, mod.id, m.enabled ? 1 : 0, m.expiresAt ?? null],
      );
    }
  });
  await invalidateTenant(id);
  await invalidateAcl(id);
  await audit('TENANT_MODULES', 'tenant', id, null, req.body, undefined, id);
  res.json({ ok: true });
});

/** Limit overrides (NULL = plan default) */
platformRouter.put('/tenants/:id/limits', body(z.object({
  maxProducts: z.number().int().nonnegative().nullable(), maxStaff: z.number().int().nonnegative().nullable(),
  maxStorageMb: z.number().int().nonnegative().nullable(),
})), async (req, res) => {
  const id = Number(req.params.id);
  await db.raw(`INSERT INTO tenant_limits (tenant_id, max_products, max_staff, max_storage_mb) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE max_products = VALUES(max_products), max_staff = VALUES(max_staff), max_storage_mb = VALUES(max_storage_mb)`,
  [id, req.body.maxProducts, req.body.maxStaff, req.body.maxStorageMb]);
  await invalidateTenant(id);
  await audit('TENANT_LIMITS', 'tenant', id, null, req.body, undefined, id);
  res.json({ ok: true });
});

/** Temporarily stop a store (e.g. unpaid) — PDF §3 step 9 */
platformRouter.post('/tenants/:id/suspend', body(z.object({ reason: z.string().min(3).max(255) })), async (req, res) => {
  const id = Number(req.params.id);
  await db('tenants').where({ id }).update({ status: 'SUSPENDED', suspended_at: new Date(), suspended_reason: req.body.reason });
  await invalidateTenant(id);
  const t = await db('tenants').where({ id }).first('owner_email', 'name');
  await sendEmail({ tenantId: id, to: t.owner_email, template: 'store_suspended', subject: `${t.name} has been suspended`, payload: { reason: req.body.reason, storeName: t.name } });
  await audit('TENANT_SUSPEND', 'tenant', id, null, req.body, undefined, id);
  res.json({ ok: true });
});

platformRouter.post('/tenants/:id/resume', async (req, res) => {
  const id = Number(req.params.id);
  const sub = await db('subscriptions').where({ tenant_id: id, is_current: 1 }).first();
  const status = sub?.status === 'TRIALING' ? 'TRIAL' : sub?.status === 'PAST_DUE' ? 'PAST_DUE' : 'ACTIVE';
  await db('tenants').where({ id }).update({ status, suspended_at: null, suspended_reason: null });
  await invalidateTenant(id);
  await audit('TENANT_RESUME', 'tenant', id, null, { status }, undefined, id);
  res.json({ ok: true, status });
});

platformRouter.post('/tenants/:id/extend', body(z.object({ days: z.number().int().min(1).max(365) })), async (req, res) => {
  const id = Number(req.params.id);
  const sub = await db('subscriptions').where({ tenant_id: id, is_current: 1 }).first();
  if (!sub) throw notFound('Subscription');
  const base = new Date(Math.max(Date.now(), new Date(sub.current_period_end).getTime()));
  const end = addDays(base, req.body.days);
  await db('subscriptions').where({ id: sub.id }).update({ current_period_end: end, grace_until: null,
    status: sub.status === 'TRIALING' ? 'TRIALING' : 'ACTIVE' });
  await db('tenants').where({ id }).update({ status: sub.status === 'TRIALING' ? 'TRIAL' : 'ACTIVE',
    trial_ends_at: sub.status === 'TRIALING' ? end : null, suspended_at: null, suspended_reason: null });
  await invalidateTenant(id);
  await audit('TENANT_EXTEND', 'tenant', id, null, req.body, undefined, id);
  res.json({ ok: true, currentPeriodEnd: end });
});

/** Impersonation — login as the store owner for support (PDF §12 phase 5). Fully audited. */
platformRouter.post('/tenants/:id/impersonate', body(z.object({ reason: z.string().min(5).max(255) })), async (req, res) => {
  const id = Number(req.params.id);
  const owner = await db('users').where({ tenant_id: id, is_owner: 1 }).first('id');
  const sub = await db('tenants').where({ id }).first('subdomain');
  if (!owner || !sub) throw notFound('Store owner');
  const admin = currentAuth();
  await db('impersonation_sessions').insert({ platform_user_id: admin.id, tenant_id: id, user_id: owner.id, reason: req.body.reason, ip: ctx()?.ip ?? null });
  const token = signAccess({ sub: String(owner.id), typ: 'USER', tid: id, own: true, imp: admin.id }, '30m');
  await audit('IMPERSONATE_START', 'tenant', id, null, { reason: req.body.reason }, undefined, id);
  res.json({ url: publicUrl(subdomainHost(sub.subdomain), `/admin/impersonate#token=${encodeURIComponent(token)}`), expiresIn: '30m' });
});

// ------------------------------------------------------------------ plans
const planSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_]{2,40}$/), name: z.string().min(2).max(100), description: z.string().max(500).nullable().optional(),
  priceMonthly: z.number().nonnegative(), priceYearly: z.number().nonnegative(), trialDays: z.number().int().min(0).max(90),
  maxProducts: z.number().int().nonnegative().nullable(), maxStaff: z.number().int().nonnegative().nullable(),
  maxStorageMb: z.number().int().nonnegative().nullable(), allowCustomDomain: z.boolean(), allowHeadlessApi: z.boolean(),
  transactionFeePercent: z.number().min(0).max(10), isPublic: z.boolean().default(true), isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0), modules: z.array(z.string()).default([]),
});
const planRow = (b: any) => ({ code: b.code, name: b.name, description: b.description ?? null, price_monthly: b.priceMonthly,
  price_yearly: b.priceYearly, trial_days: b.trialDays, max_products: b.maxProducts, max_staff: b.maxStaff, max_storage_mb: b.maxStorageMb,
  allow_custom_domain: b.allowCustomDomain, allow_headless_api: b.allowHeadlessApi, transaction_fee_percent: b.transactionFeePercent,
  is_public: b.isPublic, is_active: b.isActive, sort_order: b.sortOrder });

platformRouter.get('/plans', async (_req, res) => {
  const plans = await db('plans').orderBy('sort_order');
  const pm = await db('plan_modules as pm').join('modules as m', 'm.id', 'pm.module_id').select('pm.plan_id', 'm.code');
  const counts = await db('tenants').select('plan_id').count({ n: '*' }).groupBy('plan_id');
  res.json(plans.map((p) => ({ ...p, modules: pm.filter((x) => x.plan_id === p.id).map((x) => x.code),
    tenantCount: Number(counts.find((c: any) => c.plan_id === p.id)?.n ?? 0) })));
});
async function setPlanModules(trx: any, planId: number, codes: string[]) {
  const mods = await trx('modules').whereIn('code', codes.length ? codes : ['__none__']).select('id');
  await trx('plan_modules').where({ plan_id: planId }).delete();
  if (mods.length) await trx('plan_modules').insert(mods.map((m: any) => ({ plan_id: planId, module_id: m.id })));
}
platformRouter.post('/plans', body(planSchema), async (req, res) => {
  const id = await db.transaction(async (trx) => {
    const [pid] = await trx('plans').insert(planRow(req.body));
    await setPlanModules(trx, pid, req.body.modules);
    return pid;
  });
  await audit('PLAN_CREATE', 'plan', id, null, req.body, undefined, null);
  res.status(201).json({ id });
});
platformRouter.put('/plans/:id', body(planSchema), async (req, res) => {
  const id = Number(req.params.id);
  await db.transaction(async (trx) => {
    await trx('plans').where({ id }).update(planRow(req.body));
    await setPlanModules(trx, id, req.body.modules);
  });
  // re-sync modules of every tenant on this plan
  const tenants = await db('tenants').where({ plan_id: id }).pluck('id');
  for (const tid of tenants) {
    await syncPlanModules(tid, id, db);
    await invalidateTenant(tid);
    await invalidateAcl(tid);
  }
  await audit('PLAN_UPDATE', 'plan', id, null, req.body, undefined, null);
  res.json({ ok: true, tenantsUpdated: tenants.length });
});

// ------------------------------------------------------------------ modules
platformRouter.get('/modules', async (_req, res) => res.json(await db('modules').orderBy('sort_order')));
platformRouter.put('/modules/:id', body(z.object({
  name: z.string().min(2).max(100), description: z.string().max(500).nullable().optional(), isAddon: z.boolean(),
  addonPriceMonthly: z.number().nonnegative(), isActive: z.boolean(),
})), async (req, res) => {
  await db('modules').where({ id: Number(req.params.id) }).update({ name: req.body.name, description: req.body.description ?? null,
    is_addon: req.body.isAddon, addon_price_monthly: req.body.addonPriceMonthly, is_active: req.body.isActive });
  await invalidate('t:');
  res.json({ ok: true });
});

// ------------------------------------------------------------------ themes (incl. exclusive)
const themeSchema = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,40}$/), name: z.string().min(2).max(100), description: z.string().max(500).nullable().optional(),
  previewImageUrl: z.string().max(500).nullable().optional(), isPremium: z.boolean(), price: z.number().nonnegative(),
  ownerTenantId: z.number().int().nullable().optional(), defaultSettings: z.record(z.any()), defaultSections: z.array(z.any()),
  isActive: z.boolean().default(true), sortOrder: z.number().int().default(0),
});
const themeRow = (b: any) => ({ code: b.code, name: b.name, description: b.description ?? null, preview_image_url: b.previewImageUrl ?? null,
  is_premium: b.isPremium, price: b.price, owner_tenant_id: b.ownerTenantId ?? null, default_settings: JSON.stringify(b.defaultSettings),
  default_sections: JSON.stringify(b.defaultSections), is_active: b.isActive, sort_order: b.sortOrder });
platformRouter.get('/themes', async (_req, res) => {
  res.json(await db('themes as th').leftJoin('tenants as t', 't.id', 'th.owner_tenant_id').select('th.*', 't.name as owner_tenant_name').orderBy('th.sort_order'));
});
platformRouter.post('/themes', body(themeSchema), async (req, res) => {
  const [id] = await db('themes').insert(themeRow(req.body));
  await audit('THEME_CREATE', 'theme', id, null, { code: req.body.code }, undefined, null);
  res.status(201).json({ id });
});
platformRouter.put('/themes/:id', body(themeSchema), async (req, res) => {
  await db('themes').where({ id: Number(req.params.id) }).update(themeRow(req.body));
  await invalidate('t:');
  res.json({ ok: true });
});

// ------------------------------------------------------------------ permissions & menus (global)
platformRouter.get('/permissions', async (_req, res) => res.json(await db('permissions').orderBy('sort_order')));
platformRouter.post('/permissions', body(z.object({
  code: z.string().regex(/^[A-Z_]{3,60}$/), name: z.string().min(2).max(120), groupName: z.string().min(2).max(60),
  moduleCode: z.string().nullable().optional(), sortOrder: z.number().int().default(500),
})), async (req, res) => {
  const [id] = await db('permissions').insert({ code: req.body.code, name: req.body.name, group_name: req.body.groupName,
    module_code: req.body.moduleCode ?? null, sort_order: req.body.sortOrder });
  await audit('PERMISSION_CREATE', 'permission', id, null, req.body, undefined, null);
  res.status(201).json({ id });
});
platformRouter.put('/permissions/:id', body(z.object({ name: z.string().min(2).max(120), groupName: z.string().min(2).max(60),
  moduleCode: z.string().nullable().optional(), sortOrder: z.number().int() })), async (req, res) => {
  await db('permissions').where({ id: Number(req.params.id) }).update({ name: req.body.name, group_name: req.body.groupName,
    module_code: req.body.moduleCode ?? null, sort_order: req.body.sortOrder });
  await invalidate('t:');
  res.json({ ok: true });
});
platformRouter.get('/menu-templates', async (_req, res) => res.json(await db('menu_templates').orderBy('default_sort')));

// ------------------------------------------------------------------ subscriptions & invoices
platformRouter.get('/subscriptions', async (req, res) => {
  const q = db('subscriptions as s').join('tenants as t', 't.id', 's.tenant_id').join('plans as p', 'p.id', 's.plan_id')
    .where('s.is_current', 1).select('s.*', 't.name as tenant_name', 't.subdomain', 'p.name as plan_name');
  if (req.query.status) q.where('s.status', String(req.query.status));
  res.json(await offsetPaginate(q, req, [{ column: 's.current_period_end', order: 'asc' }]));
});
platformRouter.get('/invoices', async (req, res) => {
  const q = db('platform_invoices as i').join('tenants as t', 't.id', 'i.tenant_id').select('i.*', 't.name as tenant_name');
  if (req.query.status) q.where('i.status', String(req.query.status));
  if (req.query.tenantId) q.where('i.tenant_id', Number(req.query.tenantId));
  res.json(await offsetPaginate(q, req, [{ column: 'i.id', order: 'desc' }]));
});
platformRouter.get('/invoices/:id', async (req, res) => {
  const inv = await db('platform_invoices').where({ id: Number(req.params.id) }).first();
  if (!inv) throw notFound('Invoice');
  res.json({ ...inv, items: await db('platform_invoice_items').where({ invoice_id: inv.id }) });
});
/** Offline payment received (bank transfer/UPI) */
platformRouter.post('/invoices/:id/mark-paid', async (req, res) => {
  const id = Number(req.params.id);
  await db.transaction(async (trx) => {
    const inv = await trx('platform_invoices').where({ id }).forUpdate().first();
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'ISSUED') throw badRequest('Invoice is not open');
    await applyInvoicePaid(id, trx);
  });
  await audit('INVOICE_MARK_PAID', 'platform_invoice', id, null, null, undefined, null);
  res.json({ ok: true });
});
platformRouter.post('/invoices/:id/void', async (req, res) => {
  const n = await db('platform_invoices').where({ id: Number(req.params.id), status: 'ISSUED' }).update({ status: 'VOID' });
  if (!n) throw badRequest('Only open invoices can be voided');
  res.json({ ok: true });
});
/** Manual invoice (custom design fee etc.) */
platformRouter.post('/tenants/:id/invoices', body(z.object({
  type: z.enum(['CUSTOM_DESIGN', 'SETUP', 'OTHER', 'ADDON']),
  items: z.array(z.object({ description: z.string().min(2).max(255), unitPrice: z.number().nonnegative(), quantity: z.number().positive().default(1) })).min(1),
})), async (req, res) => {
  res.status(201).json(await createInvoice(Number(req.params.id), req.body.type, req.body.items));
});

// ------------------------------------------------------------------ service requests
platformRouter.get('/service-requests', async (req, res) => {
  const q = db('service_requests as r').join('tenants as t', 't.id', 'r.tenant_id').select('r.*', 't.name as tenant_name', 't.subdomain');
  if (req.query.status) q.where('r.status', String(req.query.status));
  res.json(await offsetPaginate(q, req, [{ column: 'r.id', order: 'desc' }]));
});
platformRouter.put('/service-requests/:id', body(z.object({
  status: z.enum(['NEW', 'QUOTED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'REJECTED']).optional(),
  quotedAmount: z.number().nonnegative().optional(), monthlyAddon: z.number().nonnegative().nullable().optional(),
  sendInvoice: z.boolean().default(false),
})), async (req, res) => {
  const id = Number(req.params.id);
  const r = await db('service_requests').where({ id }).first();
  if (!r) throw notFound('Request');
  const patch: any = {};
  if (req.body.status) patch.status = req.body.status;
  if (req.body.quotedAmount !== undefined) { patch.quoted_amount = req.body.quotedAmount; patch.status = patch.status ?? 'QUOTED'; }
  if (req.body.monthlyAddon !== undefined) patch.monthly_addon = req.body.monthlyAddon;
  await db('service_requests').where({ id }).update(patch);
  let invoice = null;
  if (req.body.sendInvoice && (req.body.quotedAmount ?? r.quoted_amount)) {
    const type = r.request_type === 'STORE_SETUP' ? 'SETUP' : 'CUSTOM_DESIGN';
    invoice = await createInvoice(Number(r.tenant_id), type, [{ description: r.title, unitPrice: Number(req.body.quotedAmount ?? r.quoted_amount), refType: 'SERVICE_REQUEST', refId: id }]);
    await db('service_requests').where({ id }).update({ invoice_id: invoice.id });
  }
  res.json({ ok: true, invoice });
});

// ------------------------------------------------------------------ platform audit log & settings
platformRouter.get('/audit', async (req, res) => {
  const q = db('audit_logs').select('*');
  if (req.query.tenantId) q.where('tenant_id', Number(req.query.tenantId));
  if (req.query.action) q.where('action', String(req.query.action));
  res.json(await cursorPaginate(q, req));
});
platformRouter.get('/settings', async (_req, res) => res.json(await db('platform_settings').select('setting_key', 'setting_value')));
platformRouter.put('/settings', body(z.record(z.string())), async (req, res) => {
  for (const [k, v] of Object.entries(req.body)) {
    await db.raw('INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [k, v]);
  }
  await audit('PLATFORM_SETTINGS', 'platform_settings', null, null, req.body, undefined, null);
  res.json({ ok: true });
});
platformRouter.get('/platform-users', async (_req, res) => res.json(await db('platform_users').select('id', 'name', 'email', 'is_active', 'last_login_at')));
platformRouter.post('/platform-users', body(z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(10) })), async (req, res) => {
  const [id] = await db('platform_users').insert({ name: req.body.name, email: req.body.email.toLowerCase(), password_hash: await bcrypt.hash(req.body.password, 12) });
  await audit('PLATFORM_USER_CREATE', 'platform_user', id, null, { email: req.body.email }, undefined, null);
  res.status(201).json({ id });
});
