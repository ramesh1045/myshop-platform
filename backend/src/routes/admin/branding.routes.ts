/**
 * Theme customisation with live preview & Draft -> Publish (PDF §5.4, §12 phase 3),
 * page builder, form builder (PDF §9), Blog & Booking add-on modules (PDF §9)
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex';
import { tq, tinsert, safePatch } from '../../db/tenant-scope';
import { currentAuth, currentTenant } from '../../context/request-context';
import { body } from '../../middleware/common';
import { requireModule, requirePermission } from '../../middleware/auth';
import { badRequest, notFound } from '../../lib/http-error';
import { offsetPaginate } from '../../lib/pagination';
import { audit } from '../../lib/audit';
import { uniqueSlug } from '../../lib/util';
import { signAccess } from '../../lib/jwt';
import { invalidate, keys } from '../../cache/cache';
import { publicUrl } from '../../config/env';
import { crudRouter } from '../crud';

export const brandingRouter = Router();
const sfInvalidate = () => invalidate(keys.storefront(currentTenant().id));

// ------------------------------------------------------------------ THEME
export const SECTION_TYPES = ['HERO_BANNER', 'CATEGORY_GRID', 'FEATURED_PRODUCTS', 'NEW_ARRIVALS', 'RICH_TEXT',
  'IMAGE_WITH_TEXT', 'GALLERY', 'TESTIMONIALS', 'NEWSLETTER', 'FORM', 'VIDEO', 'SPACER', 'BLOG_POSTS', 'BOOKING_CTA'] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const sectionSchema = z.object({
  id: z.string().min(1).max(40), type: z.enum(SECTION_TYPES), enabled: z.boolean().default(true),
  config: z.record(z.any()).default({}),
});
const themeSettingsSchema = z.object({
  colors: z.object({ primary: hex, secondary: hex, background: hex, surface: hex, text: hex, accent: hex }),
  font: z.string().max(60), headingFont: z.string().max(60).optional(),
  logoUrl: z.string().max(500).nullable().optional(), faviconUrl: z.string().max(500).nullable().optional(),
  bannerUrl: z.string().max(500).nullable().optional(),
  borderRadius: z.number().int().min(0).max(32),
  productCardStyle: z.enum(['bordered', 'minimal', 'overlay']).optional(),
}).passthrough();

/** Themes this tenant may use: free + purchased premium + its own exclusive theme (PDF §9) */
async function availableThemes(tenantId: number) {
  const owned = await db('tenant_themes').where({ tenant_id: tenantId }).pluck('theme_id');
  const rows = await db('themes').where({ is_active: 1 })
    .where((w) => w.whereNull('owner_tenant_id').orWhere('owner_tenant_id', tenantId)).orderBy('sort_order');
  return rows.map((t: any) => ({
    id: t.id, code: t.code, name: t.name, description: t.description, previewImageUrl: t.preview_image_url,
    isPremium: t.is_premium, price: t.price, exclusive: t.owner_tenant_id === tenantId,
    owned: !t.is_premium || owned.includes(t.id) || t.owner_tenant_id === tenantId,
    defaultSettings: t.default_settings, defaultSections: t.default_sections,
  }));
}

brandingRouter.get('/theme', requirePermission('THEME_MANAGE'), async (_req, res) => {
  const t = currentTenant();
  const rows = await tq('tenant_theme_settings as s').join('themes as th', 'th.id', 's.theme_id')
    .select('s.stage', 's.theme_id', 'th.code as theme_code', 's.settings', 's.sections', 's.version', 's.updated_at', 's.published_at');
  res.json({
    draft: rows.find((r: any) => r.stage === 'DRAFT'),
    published: rows.find((r: any) => r.stage === 'PUBLISHED'),
    themes: await availableThemes(t.id),
    sectionTypes: SECTION_TYPES,
  });
});

/** Save draft (layer 1 theme choice + layer 2 customisation + layer 3 sections) */
brandingRouter.put('/theme/draft', requirePermission('THEME_MANAGE'), body(z.object({
  themeId: z.number().int().optional(),
  settings: themeSettingsSchema.optional(),
  sections: z.array(sectionSchema).max(40).optional(),
  version: z.number().int().optional(), // optimistic lock
})), async (req, res) => {
  const t = currentTenant();
  const draft = await tq('tenant_theme_settings').where({ stage: 'DRAFT' }).first();
  if (req.body.version && req.body.version !== draft.version) throw badRequest('Theme was changed by someone else. Reload and try again.');
  const patch: any = { version: draft.version + 1, updated_by: currentAuth().id };
  if (req.body.themeId && req.body.themeId !== draft.theme_id) {
    const th = (await availableThemes(t.id)).find((x) => x.id === req.body.themeId);
    if (!th) throw badRequest('Theme not available');
    if (!th.owned) throw badRequest('Buy this premium theme first');
    patch.theme_id = th.id;
    // switching theme: keep client's colours/logo, take theme defaults for anything missing
    if (!req.body.settings) patch.settings = JSON.stringify({ ...th.defaultSettings, ...pickBrand(draft.settings) });
  }
  if (req.body.settings) patch.settings = JSON.stringify(req.body.settings);
  if (req.body.sections) patch.sections = JSON.stringify(req.body.sections);
  await tq('tenant_theme_settings').where({ stage: 'DRAFT' }).update(patch);
  res.json({ version: patch.version });
});
const pickBrand = (s: any) => ({ logoUrl: s?.logoUrl, faviconUrl: s?.faviconUrl, bannerUrl: s?.bannerUrl, colors: s?.colors });

/** Short-lived token -> storefront loads DRAFT config inside the preview iframe */
brandingRouter.post('/theme/preview-token', requirePermission('THEME_MANAGE'), async (_req, res) => {
  const t = currentTenant();
  const token = signAccess({ sub: String(currentAuth().id), typ: 'PREVIEW', tid: t.id }, '30m');
  res.json({ token, previewUrl: publicUrl(t.primaryDomain, `/?preview=${encodeURIComponent(token)}`) });
});

/** Draft -> Publish */
brandingRouter.post('/theme/publish', requirePermission('THEME_MANAGE'), async (_req, res) => {
  const draft = await tq('tenant_theme_settings').where({ stage: 'DRAFT' }).first();
  const old = await tq('tenant_theme_settings').where({ stage: 'PUBLISHED' }).first();
  await tq('tenant_theme_settings').where({ stage: 'PUBLISHED' }).update({
    theme_id: draft.theme_id, settings: JSON.stringify(draft.settings), sections: JSON.stringify(draft.sections),
    version: old.version + 1, published_at: new Date(), updated_by: currentAuth().id,
  });
  await sfInvalidate();
  await audit('THEME_PUBLISH', 'theme', draft.theme_id, { version: old.version }, { version: old.version + 1 });
  res.json({ ok: true, publishedAt: new Date() });
});

brandingRouter.post('/theme/discard-draft', requirePermission('THEME_MANAGE'), async (_req, res) => {
  const pub = await tq('tenant_theme_settings').where({ stage: 'PUBLISHED' }).first();
  const draft = await tq('tenant_theme_settings').where({ stage: 'DRAFT' }).first();
  await tq('tenant_theme_settings').where({ stage: 'DRAFT' }).update({
    theme_id: pub.theme_id, settings: JSON.stringify(pub.settings), sections: JSON.stringify(pub.sections), version: draft.version + 1,
  });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ PAGE BUILDER (About, Gallery, Contact...)
const pageSchema = z.object({
  title: z.string().min(1).max(150), slug: z.string().max(160).optional(),
  sections: z.array(sectionSchema).max(60).default([]),
  showInNav: z.boolean().optional(), navOrder: z.number().int().optional(),
  seoTitle: z.string().max(200).nullable().optional(), seoDescription: z.string().max(500).nullable().optional(),
});
const pages = Router();
pages.get('/', async (req, res) => {
  res.json(await offsetPaginate(tq('pages').select('id', 'title', 'slug', 'status', 'show_in_nav', 'nav_order', 'updated_at', 'published_at'),
    req, [{ column: 'nav_order', order: 'asc' }]));
});
pages.get('/:id', async (req, res) => {
  const p = await tq('pages').where({ id: Number(req.params.id) }).first();
  if (!p) throw notFound('Page');
  res.json(p);
});
pages.post('/', body(pageSchema), async (req, res) => {
  const t = currentTenant();
  const slug = await uniqueSlug(db, 'pages', t.id, req.body.slug || req.body.title);
  if (['products', 'product', 'cart', 'checkout', 'account', 'admin', 'blog', 'booking', 'category', 'track'].includes(slug)) throw badRequest('This URL is reserved');
  const id = await tinsert('pages', { title: req.body.title, slug, sections: JSON.stringify(req.body.sections),
    show_in_nav: req.body.showInNav ?? true, nav_order: req.body.navOrder ?? 0, seo_title: req.body.seoTitle ?? null,
    seo_description: req.body.seoDescription ?? null });
  await audit('PAGE_CREATE', 'page', id, null, { title: req.body.title });
  res.status(201).json({ id, slug });
});
pages.put('/:id', body(pageSchema.partial()), async (req, res) => {
  const t = currentTenant();
  const id = Number(req.params.id);
  if (!(await tq('pages').where({ id }).first('id'))) throw notFound('Page');
  const patch: any = safePatch({
    title: req.body.title, sections: req.body.sections ? JSON.stringify(req.body.sections) : undefined,
    show_in_nav: req.body.showInNav, nav_order: req.body.navOrder, seo_title: req.body.seoTitle, seo_description: req.body.seoDescription,
  });
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
  if (req.body.slug) patch.slug = await uniqueSlug(db, 'pages', t.id, req.body.slug, id);
  await tq('pages').where({ id }).update(patch);
  await sfInvalidate();
  res.json({ ok: true });
});
pages.post('/:id/publish', async (req, res) => {
  const p = await tq('pages').where({ id: Number(req.params.id) }).first();
  if (!p) throw notFound('Page');
  await tq('pages').where({ id: p.id }).update({ status: 'PUBLISHED', published_sections: JSON.stringify(p.sections), published_at: new Date() });
  await sfInvalidate();
  await audit('PAGE_PUBLISH', 'page', p.id);
  res.json({ ok: true });
});
pages.post('/:id/unpublish', async (req, res) => {
  await tq('pages').where({ id: Number(req.params.id) }).update({ status: 'DRAFT' });
  await sfInvalidate();
  res.json({ ok: true });
});
pages.delete('/:id', async (req, res) => {
  const n = await tq('pages').where({ id: Number(req.params.id) }).delete();
  if (!n) throw notFound('Page');
  await sfInvalidate();
  res.status(204).end();
});
brandingRouter.use('/pages', requireModule('PAGE_BUILDER'), requirePermission('PAGE_MANAGE'), pages);

// ------------------------------------------------------------------ FORM BUILDER
const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), label: z.string().min(1).max(100),
  type: z.enum(['text', 'email', 'tel', 'number', 'textarea', 'select', 'checkbox', 'date']),
  required: z.boolean().default(false), options: z.array(z.string().max(100)).max(50).optional(),
});
brandingRouter.get('/forms/:id/submissions', requireModule('PAGE_BUILDER'), requirePermission('FORM_MANAGE'), async (req, res) => {
  const fid = Number(req.params.id);
  res.json(await offsetPaginate(tq('form_submissions').where({ form_id: fid }), req, [{ column: 'id', order: 'desc' }]));
});
brandingRouter.put('/forms/:id/submissions/:sid/read', requireModule('PAGE_BUILDER'), requirePermission('FORM_MANAGE'), async (req, res) => {
  await tq('form_submissions').where({ id: Number(req.params.sid), form_id: Number(req.params.id) }).update({ is_read: 1 });
  res.json({ ok: true });
});
brandingRouter.use('/forms', requireModule('PAGE_BUILDER'), requirePermission('FORM_MANAGE'), crudRouter({
  table: 'forms', entity: 'form',
  schema: z.object({
    name: z.string().min(1).max(120), fields: z.array(fieldSchema).min(1).max(30),
    notifyEmail: z.string().email().nullable().optional(), successMessage: z.string().max(300).optional(), isActive: z.boolean().optional(),
  }),
  toRow: (b) => ({ name: b.name, fields: b.fields ? JSON.stringify(b.fields) : undefined, notify_email: b.notifyEmail,
    success_message: b.successMessage, is_active: b.isActive }),
}));

// ------------------------------------------------------------------ BLOG add-on
brandingRouter.use('/blog', requireModule('BLOG'), requirePermission('BLOG_MANAGE'), crudRouter({
  table: 'blog_posts', entity: 'blog_post', slugFrom: 'title',
  schema: z.object({
    title: z.string().min(2).max(200), slug: z.string().max(220).optional(), excerpt: z.string().max(500).nullable().optional(),
    content: z.string().max(200_000), coverImageUrl: z.string().max(500).nullable().optional(),
    status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
    seoTitle: z.string().max(200).nullable().optional(), seoDescription: z.string().max(500).nullable().optional(),
  }),
  toRow: (b) => ({
    title: b.title, excerpt: b.excerpt, content: b.content, cover_image_url: b.coverImageUrl, status: b.status,
    seo_title: b.seoTitle, seo_description: b.seoDescription,
    published_at: b.status === 'PUBLISHED' ? new Date() : undefined,
  }),
  beforeCreate: async (row) => { row.author_id = currentAuth().id; },
  listColumns: ['id', 'title', 'slug', 'status', 'published_at', 'updated_at'],
  searchColumns: ['title'], filters: ['status'],
}));

// ------------------------------------------------------------------ BOOKING add-on
brandingRouter.use('/booking-services', requireModule('BOOKING'), requirePermission('BOOKING_MANAGE'), crudRouter({
  table: 'booking_services', entity: 'booking_service',
  schema: z.object({
    name: z.string().min(2).max(150), description: z.string().max(500).nullable().optional(),
    durationMinutes: z.number().int().min(5).max(480), price: z.number().nonnegative(),
    slotsPerTime: z.number().int().min(1).max(100).optional(), isActive: z.boolean().optional(),
  }),
  toRow: (b) => ({ name: b.name, description: b.description, duration_minutes: b.durationMinutes, price: b.price,
    slots_per_time: b.slotsPerTime, is_active: b.isActive }),
}));
brandingRouter.get('/bookings', requireModule('BOOKING'), requirePermission('BOOKING_MANAGE'), async (req, res) => {
  const q = tq('bookings as b').join('booking_services as s', function () { this.on('s.id', '=', 'b.service_id').andOn('s.tenant_id', '=', 'b.tenant_id'); })
    .select('b.*', 's.name as service_name');
  if (req.query.date) q.where('b.booking_date', String(req.query.date));
  if (req.query.status) q.where('b.status', String(req.query.status));
  res.json(await offsetPaginate(q, req, [{ column: 'b.booking_date', order: 'desc' }, { column: 'b.start_time', order: 'asc' }]));
});
brandingRouter.put('/bookings/:id/status', requireModule('BOOKING'), requirePermission('BOOKING_MANAGE'),
  body(z.object({ status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']) })), async (req, res) => {
    const n = await tq('bookings').where({ id: Number(req.params.id) }).update({ status: req.body.status });
    if (!n) throw notFound('Booking');
    res.json({ ok: true });
  });
