/**
 * Dynamic access control — PDF §5.1 (roles & permissions), §5.2 (menus), §5.3 (users),
 * §3 step 5 (owner creates roles and ticks permissions), §12 phase 2 (audit log)
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex';
import { tq, tinsert } from '../../db/tenant-scope';
import { currentAuth, currentTenant } from '../../context/request-context';
import { body } from '../../middleware/common';
import { requirePermission } from '../../middleware/auth';
import { HttpError, badRequest, forbidden, notFound } from '../../lib/http-error';
import { cursorPaginate, offsetPaginate } from '../../lib/pagination';
import { audit } from '../../lib/audit';
import { randomToken, sha256 } from '../../lib/crypto';
import { sendEmail } from '../../lib/queue';
import { publicUrl } from '../../config/env';
import { assertStaffLimit, enabledModules, invalidateAcl, menuItemsForTenant } from '../../services/access.service';

export const accessRouter = Router();

// ------------------------------------------------------------------ permissions (global list)
accessRouter.get('/permissions', requirePermission('ROLE_MANAGE'), async (_req, res) => {
  const mods = await enabledModules(currentTenant().id);
  const rows = await db('permissions').where((w) => w.whereNull('module_code').orWhereIn('module_code', mods))
    .orderBy('sort_order').select('id', 'code', 'name', 'group_name', 'module_code');
  const groups: Record<string, any[]> = {};
  for (const r of rows) (groups[r.group_name] ??= []).push(r);
  res.json(Object.entries(groups).map(([group, permissions]) => ({ group, permissions })));
});

// ------------------------------------------------------------------ roles
accessRouter.get('/roles', requirePermission('ROLE_MANAGE', 'STAFF_VIEW'), async (_req, res) => {
  const t = currentTenant();
  const roles = await tq('roles').orderBy('name');
  const perms = await db('role_permissions as rp').join('permissions as p', 'p.id', 'rp.permission_id')
    .where('rp.tenant_id', t.id).select('rp.role_id', 'p.code');
  const counts = await tq('user_roles').groupBy('role_id').select('role_id').count({ n: '*' });
  res.json(roles.map((r: any) => ({
    ...r,
    permissions: perms.filter((p) => p.role_id === r.id).map((p) => p.code),
    userCount: Number(counts.find((c: any) => c.role_id === r.id)?.n ?? 0),
  })));
});

const roleSchema = z.object({
  name: z.string().min(2).max(80), description: z.string().max(255).nullable().optional(),
  permissions: z.array(z.string()).default([]),
});

async function setRolePermissions(trx: any, tenantId: number, roleId: number, codes: string[]) {
  const mods = await enabledModules(tenantId);
  // only codes from the GLOBAL permission list are accepted (PDF §5.1)
  const valid = await trx('permissions').whereIn('code', codes.length ? codes : ['__none__'])
    .where((w: any) => w.whereNull('module_code').orWhereIn('module_code', mods)).select('id', 'code');
  if (valid.length !== new Set(codes).size) throw badRequest('Unknown or unavailable permission code');
  await tq('role_permissions', trx).where({ role_id: roleId }).delete();
  if (valid.length) await tinsert('role_permissions', valid.map((p: any) => ({ role_id: roleId, permission_id: p.id })), trx);
}

accessRouter.post('/roles', requirePermission('ROLE_MANAGE'), body(roleSchema), async (req, res) => {
  const t = currentTenant();
  const id = await db.transaction(async (trx) => {
    const roleId = await tinsert('roles', { name: req.body.name, description: req.body.description ?? null }, trx);
    await setRolePermissions(trx, t.id, roleId, req.body.permissions);
    return roleId;
  });
  await invalidateAcl(t.id);
  await audit('ROLE_CREATE', 'role', id, null, req.body);
  res.status(201).json({ id });
});

accessRouter.put('/roles/:id', requirePermission('ROLE_MANAGE'), body(roleSchema.partial()), async (req, res) => {
  const t = currentTenant();
  const id = Number(req.params.id);
  const old = await tq('roles').where({ id }).first();
  if (!old) throw notFound('Role');
  await db.transaction(async (trx) => {
    const patch: any = {};
    if (req.body.name) patch.name = req.body.name;
    if (req.body.description !== undefined) patch.description = req.body.description;
    if (Object.keys(patch).length) await tq('roles', trx).where({ id }).update(patch);
    if (req.body.permissions) await setRolePermissions(trx, t.id, id, req.body.permissions);
  });
  await invalidateAcl(t.id); // new permissions apply on the next request — no code change, no re-login
  await audit('ROLE_UPDATE', 'role', id, old, req.body);
  res.json({ ok: true });
});

accessRouter.delete('/roles/:id', requirePermission('ROLE_MANAGE'), async (req, res) => {
  const t = currentTenant();
  const id = Number(req.params.id);
  const n = await tq('roles').where({ id }).delete(); // cascades role_permissions & user_roles
  if (!n) throw notFound('Role');
  await invalidateAcl(t.id);
  await audit('ROLE_DELETE', 'role', id);
  res.status(204).end();
});

// ------------------------------------------------------------------ staff (users)
accessRouter.get('/staff', requirePermission('STAFF_VIEW'), async (req, res) => {
  const t = currentTenant();
  const page = await offsetPaginate<any>(tq('users').select('id', 'name', 'email', 'mobile', 'is_owner', 'status', 'last_login_at', 'created_at'),
    req, [{ column: 'is_owner', order: 'desc' }, { column: 'created_at', order: 'asc' }]);
  const ids = page.items.map((u) => u.id);
  const ur = ids.length ? await db('user_roles as ur').join('roles as r', function () { this.on('r.id', '=', 'ur.role_id').andOn('r.tenant_id', '=', 'ur.tenant_id'); })
    .where('ur.tenant_id', t.id).whereIn('ur.user_id', ids).select('ur.user_id', 'r.id', 'r.name') : [];
  res.json({ ...page, items: page.items.map((u) => ({ ...u, roles: ur.filter((r) => r.user_id === u.id).map((r) => ({ id: r.id, name: r.name })) })) });
});

async function assertRoles(roleIds: number[], trx?: any) {
  if (!roleIds.length) return;
  const found = await tq('roles', trx).whereIn('id', roleIds).pluck('id');
  if (found.length !== new Set(roleIds).size) throw badRequest('Invalid role');
}

/** Invite staff by email with one or more roles; limited by plan (PDF §5.3) */
accessRouter.post('/staff/invite', requirePermission('STAFF_MANAGE'), body(z.object({
  email: z.string().email(), name: z.string().min(2).max(120), mobile: z.string().max(20).nullable().optional(),
  roleIds: z.array(z.number().int()).min(1),
})), async (req, res) => {
  const t = currentTenant();
  await assertStaffLimit(t.id);
  await assertRoles(req.body.roleIds);
  const token = randomToken();
  const userId = await db.transaction(async (trx) => {
    const exists = await tq('users', trx).where({ email: req.body.email.toLowerCase() }).first('id');
    if (exists) throw new HttpError(409, 'EXISTS', 'A user with this email already exists');
    const uid = await tinsert('users', { email: req.body.email.toLowerCase(), name: req.body.name, mobile: req.body.mobile ?? null, status: 'INVITED' }, trx);
    await tinsert('user_roles', req.body.roleIds.map((r: number) => ({ user_id: uid, role_id: r })), trx);
    await tinsert('user_invitations', { user_id: uid, token_hash: sha256(token), invited_by: currentAuth().id,
      expires_at: new Date(Date.now() + 7 * 86400_000) }, trx);
    return uid;
  });
  const link = publicUrl(t.primaryDomain, `/admin/accept-invite?token=${token}`);
  await sendEmail({ tenantId: t.id, to: req.body.email, template: 'staff_invite', subject: `You are invited to ${t.name}`,
    payload: { storeName: t.name, name: req.body.name, link } });
  await invalidateAcl(t.id);
  await audit('STAFF_INVITE', 'user', userId, null, { email: req.body.email, roleIds: req.body.roleIds });
  res.status(201).json({ id: userId, inviteLink: link });
});

accessRouter.post('/staff/:id/resend-invite', requirePermission('STAFF_MANAGE'), async (req, res) => {
  const t = currentTenant();
  const u = await tq('users').where({ id: Number(req.params.id), status: 'INVITED' }).first();
  if (!u) throw notFound('Invited user');
  const token = randomToken();
  await tinsert('user_invitations', { user_id: u.id, token_hash: sha256(token), invited_by: currentAuth().id,
    expires_at: new Date(Date.now() + 7 * 86400_000) });
  const link = publicUrl(t.primaryDomain, `/admin/accept-invite?token=${token}`);
  await sendEmail({ tenantId: t.id, to: u.email, template: 'staff_invite', subject: `You are invited to ${t.name}`, payload: { storeName: t.name, name: u.name, link } });
  res.json({ inviteLink: link });
});

accessRouter.put('/staff/:id', requirePermission('STAFF_MANAGE'), body(z.object({
  name: z.string().min(2).max(120).optional(), mobile: z.string().max(20).nullable().optional(),
  roleIds: z.array(z.number().int()).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional(),
})), async (req, res) => {
  const t = currentTenant();
  const id = Number(req.params.id);
  const u = await tq('users').where({ id }).first();
  if (!u) throw notFound('User');
  if (u.is_owner) throw forbidden('The store owner cannot be changed here');
  if (id === currentAuth().id && req.body.status === 'DISABLED') throw badRequest('You cannot disable yourself');
  if (req.body.status === 'ACTIVE' && u.status === 'DISABLED') await assertStaffLimit(t.id);
  if (req.body.roleIds) await assertRoles(req.body.roleIds);
  await db.transaction(async (trx) => {
    const patch: any = {};
    if (req.body.name) patch.name = req.body.name;
    if (req.body.mobile !== undefined) patch.mobile = req.body.mobile;
    if (req.body.status) patch.status = u.status === 'INVITED' && req.body.status === 'ACTIVE' ? 'INVITED' : req.body.status;
    if (Object.keys(patch).length) await tq('users', trx).where({ id }).update(patch);
    if (req.body.roleIds) {
      await tq('user_roles', trx).where({ user_id: id }).delete();
      if (req.body.roleIds.length) await tinsert('user_roles', req.body.roleIds.map((r: number) => ({ user_id: id, role_id: r })), trx);
    }
    if (req.body.status === 'DISABLED') {
      await db('refresh_tokens').where({ subject_type: 'USER', subject_id: id, tenant_id: t.id }).update({ revoked_at: new Date() }).transacting(trx);
    }
  });
  await invalidateAcl(t.id);
  await audit('STAFF_UPDATE', 'user', id, { status: u.status }, req.body);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ menus (rename / hide / reorder)
accessRouter.get('/menus', requirePermission('MENU_MANAGE'), async (_req, res) => {
  const t = currentTenant();
  const mods = await enabledModules(t.id);
  const items = (await menuItemsForTenant(t.id)).filter((m) => !m.moduleCode || mods.includes(m.moduleCode));
  res.json(items);
});

accessRouter.put('/menus', requirePermission('MENU_MANAGE'), body(z.object({
  items: z.array(z.object({
    id: z.number().int(), customLabel: z.string().max(100).nullable().optional(),
    isHidden: z.boolean().optional(), sortOrder: z.number().int().optional(),
  })).max(200),
})), async (req, res) => {
  const t = currentTenant();
  const protectedIds = await db('menu_templates').whereIn('code', ['menus']).pluck('id');
  await db.transaction(async (trx) => {
    for (const i of req.body.items) {
      if (i.isHidden && protectedIds.includes(i.id)) throw badRequest('The Menus page itself cannot be hidden');
      const patch: any = {};
      if (i.customLabel !== undefined) patch.custom_label = i.customLabel?.trim() || null;
      if (i.isHidden !== undefined) patch.is_hidden = i.isHidden ? 1 : 0;
      if (i.sortOrder !== undefined) patch.sort_order = i.sortOrder;
      await trx.raw(
        `INSERT INTO tenant_menus (tenant_id, menu_template_id, custom_label, is_hidden, sort_order)
         SELECT ?, id, ?, ?, ? FROM menu_templates WHERE id = ?
         ON DUPLICATE KEY UPDATE custom_label = IF(?, VALUES(custom_label), custom_label),
           is_hidden = IF(?, VALUES(is_hidden), is_hidden), sort_order = IF(?, VALUES(sort_order), sort_order)`,
        [t.id, patch.custom_label ?? null, patch.is_hidden ?? 0, patch.sort_order ?? 0, i.id,
          'custom_label' in patch, 'is_hidden' in patch, 'sort_order' in patch],
      );
    }
  });
  await invalidateAcl(t.id);
  await audit('MENU_UPDATE', 'menu', null, null, req.body.items);
  res.json({ ok: true });
});

accessRouter.post('/menus/reset', requirePermission('MENU_MANAGE'), async (_req, res) => {
  const t = currentTenant();
  await db.raw(`UPDATE tenant_menus tm JOIN menu_templates mt ON mt.id = tm.menu_template_id
    SET tm.custom_label = NULL, tm.is_hidden = 0, tm.sort_order = mt.default_sort WHERE tm.tenant_id = ?`, [t.id]);
  await invalidateAcl(t.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ audit log (cursor — PDF §8 "logs")
accessRouter.get('/audit', requirePermission('AUDIT_VIEW'), async (req, res) => {
  const q = tq('audit_logs').select('id', 'actor_type', 'actor_id', 'impersonator_id', 'action', 'entity_type', 'entity_id',
    'old_values', 'new_values', 'ip', 'created_at');
  if (req.query.action) q.where('action', String(req.query.action));
  if (req.query.entityType) q.where('entity_type', String(req.query.entityType));
  const page = await cursorPaginate<any>(q, req);
  const userIds = [...new Set(page.items.filter((i) => i.actor_type === 'USER').map((i) => i.actor_id))];
  const users = userIds.length ? await tq('users').whereIn('id', userIds).select('id', 'name') : [];
  res.json({ ...page, items: page.items.map((i) => ({ ...i, actor_name: users.find((u: any) => u.id === i.actor_id)?.name ?? null })) });
});
