/**
 * PDF §3 step 3: "System creates the store automatically — owner account, default roles,
 * menus, theme, settings all ready." One DB transaction; one row in tenant_domains makes
 * kavya.myshop.com live instantly (wildcard DNS + wildcard SSL, PDF §2).
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db/knex';
import { badRequest, conflict } from '../lib/http-error';
import { SUBDOMAIN_RE, addDays } from '../lib/util';
import { subdomainHost } from '../config/env';
import { audit } from '../lib/audit';

/** Default roles every new shop gets (client can edit / add more — PDF §3 step 5) */
export const DEFAULT_ROLES: { name: string; description: string; permissions: string[] }[] = [
  {
    name: 'Store Manager',
    description: 'Products, orders and reports',
    permissions: ['PRODUCT_VIEW', 'PRODUCT_CREATE', 'PRODUCT_EDIT', 'PRODUCT_DELETE', 'CATEGORY_MANAGE', 'MEDIA_UPLOAD',
      'ORDER_VIEW', 'ORDER_UPDATE', 'ORDER_CANCEL', 'REPORT_VIEW'],
  },
  {
    name: 'Billing Staff',
    description: 'Orders only',
    permissions: ['ORDER_VIEW', 'ORDER_UPDATE'],
  },
];

export async function reservedSubdomains(): Promise<string[]> {
  const r = await db('platform_settings').where({ setting_key: 'reserved_subdomains' }).first();
  return String(r?.setting_value || 'www,admin,api').split(',').map((s) => s.trim());
}

export async function isSubdomainAvailable(sub: string): Promise<{ available: boolean; reason?: string }> {
  const s = sub.toLowerCase();
  if (!SUBDOMAIN_RE.test(s)) return { available: false, reason: 'Use 3-63 letters, numbers or hyphens' };
  if ((await reservedSubdomains()).includes(s)) return { available: false, reason: 'This name is reserved' };
  const taken = await db('tenants').where({ subdomain: s }).first('id');
  return taken ? { available: false, reason: 'Already taken' } : { available: true };
}

export interface ProvisionInput {
  storeName: string; ownerName: string; email: string; mobile: string; password: string;
  subdomain: string; planCode: string; billingCycle: 'MONTHLY' | 'YEARLY'; startTrial: boolean;
}

export async function provisionTenant(input: ProvisionInput) {
  const sub = input.subdomain.toLowerCase();
  const avail = await isSubdomainAvailable(sub);
  if (!avail.available) throw conflict(`Subdomain not available: ${avail.reason}`);

  const plan = await db('plans').where({ code: input.planCode, is_active: 1 }).first();
  if (!plan) throw badRequest('Invalid plan');
  const defaultTheme = await db('themes').where({ code: 'classic' }).first();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const now = new Date();
  const trial = input.startTrial && plan.trial_days > 0;

  return db.transaction(async (trx) => {
    const [tenantId] = await trx('tenants').insert({
      uuid: crypto.randomUUID(), name: input.storeName, subdomain: sub, owner_name: input.ownerName,
      owner_email: input.email.toLowerCase(), owner_mobile: input.mobile, plan_id: plan.id,
      status: trial ? 'TRIAL' : 'PENDING_PAYMENT',
      trial_ends_at: trial ? addDays(now, plan.trial_days) : null,
    });
    const tid = Number(tenantId);

    // subdomain row -> store is live (PDF §2)
    await trx('tenant_domains').insert({
      tenant_id: tid, domain: subdomainHost(sub), type: 'SUBDOMAIN', is_primary: 1,
      verification_status: 'VERIFIED', verified_at: now,
    });
    await trx('tenant_settings').insert({ tenant_id: tid, store_email: input.email.toLowerCase(), store_phone: input.mobile });
    await trx('tenant_limits').insert({ tenant_id: tid });

    // plan modules ON
    const planMods = await trx('plan_modules').where({ plan_id: plan.id }).select('module_id');
    if (planMods.length) {
      await trx('tenant_modules').insert(planMods.map((m) => ({ tenant_id: tid, module_id: m.module_id, source: 'PLAN' })));
    }

    // owner account
    const [ownerId] = await trx('users').insert({
      tenant_id: tid, email: input.email.toLowerCase(), password_hash: passwordHash, name: input.ownerName,
      mobile: input.mobile, is_owner: 1, status: 'ACTIVE',
    });

    // default roles
    const perms = await trx('permissions').select('id', 'code');
    const permId = new Map(perms.map((p) => [p.code, p.id]));
    for (const r of DEFAULT_ROLES) {
      const [roleId] = await trx('roles').insert({ tenant_id: tid, name: r.name, description: r.description, is_system: 1 });
      await trx('role_permissions').insert(
        r.permissions.filter((c) => permId.has(c)).map((c) => ({ tenant_id: tid, role_id: roleId, permission_id: permId.get(c) })),
      );
    }

    // menus (client can rename / hide / reorder later)
    const menus = await trx('menu_templates').select('id', 'default_sort');
    await trx('tenant_menus').insert(menus.map((m) => ({ tenant_id: tid, menu_template_id: m.id, sort_order: m.default_sort })));

    // theme: draft + published copies of default theme
    for (const stage of ['DRAFT', 'PUBLISHED'] as const) {
      await trx('tenant_theme_settings').insert({
        tenant_id: tid, stage, theme_id: defaultTheme.id,
        settings: JSON.stringify(defaultTheme.default_settings),
        sections: JSON.stringify(defaultTheme.default_sections),
        published_at: stage === 'PUBLISHED' ? now : null,
      });
    }

    // starter pages: About + Contact (with a contact form) — PDF §9 page builder
    const [formId] = await trx('forms').insert({
      tenant_id: tid, name: 'Contact form', notify_email: input.email.toLowerCase(),
      fields: JSON.stringify([
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'mobile', label: 'Mobile', type: 'tel', required: true },
        { key: 'message', label: 'Message', type: 'textarea', required: true },
      ]),
    });
    const aboutSections = [{ id: 'a1', type: 'RICH_TEXT', enabled: true, config: { html: `<h2>About ${escapeHtml(input.storeName)}</h2><p>Tell your customers your story.</p>` } }];
    const contactSections = [
      { id: 'c1', type: 'RICH_TEXT', enabled: true, config: { html: `<h2>Contact us</h2><p>Phone: ${escapeHtml(input.mobile)}</p>` } },
      { id: 'c2', type: 'FORM', enabled: true, config: { formId: Number(formId) } },
    ];
    await trx('pages').insert([
      { tenant_id: tid, title: 'About', slug: 'about', sections: JSON.stringify(aboutSections), published_sections: JSON.stringify(aboutSections), status: 'PUBLISHED', nav_order: 1, published_at: now },
      { tenant_id: tid, title: 'Contact', slug: 'contact', sections: JSON.stringify(contactSections), published_sections: JSON.stringify(contactSections), status: 'PUBLISHED', nav_order: 2, published_at: now },
    ]);

    // subscription
    const amount = input.billingCycle === 'YEARLY' ? Number(plan.price_yearly) : Number(plan.price_monthly);
    const [subId] = await trx('subscriptions').insert({
      tenant_id: tid, plan_id: plan.id, billing_cycle: input.billingCycle,
      status: trial ? 'TRIALING' : 'PAST_DUE', amount,
      current_period_start: now,
      current_period_end: trial ? addDays(now, plan.trial_days) : now,
      grace_until: trial ? null : addDays(now, 1),
    });

    await audit('TENANT_SIGNUP', 'tenant', tid, null, { sub, plan: plan.code, trial }, trx, tid);
    return { tenantId: tid, ownerId: Number(ownerId), subscriptionId: Number(subId), plan, trial, amount };
  });
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
