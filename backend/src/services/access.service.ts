/**
 * Dynamic roles / permissions / menus / modules / plan limits — PDF §5.1, §5.2, §5.3, §3 step 9
 */
import { db } from '../db/knex';
import { cached, invalidate, keys } from '../cache/cache';
import { limitReached } from '../lib/http-error';

/** Codes of modules that are ON for the tenant (plan modules + add-ons + manual, not expired). */
export async function enabledModules(tenantId: number): Promise<string[]> {
  return cached(keys.modules(tenantId), async () => {
    const rows = await db('tenant_modules as tm')
      .join('modules as m', 'm.id', 'tm.module_id')
      .where('tm.tenant_id', tenantId)
      .where('tm.is_enabled', 1)
      .where('m.is_active', 1)
      .where((q) => q.whereNull('tm.expires_at').orWhere('tm.expires_at', '>', db.fn.now()))
      .select('m.code');
    const core = await db('modules').where({ is_core: 1, is_active: 1 }).select('code');
    return [...new Set([...core.map((r) => r.code), ...rows.map((r) => r.code)])];
  }, { ttlSec: 300 });
}

/** All permission codes for the store user. Owner gets every permission of enabled modules. */
export async function userPermissions(tenantId: number, userId: number, isOwner: boolean): Promise<string[]> {
  return cached(keys.perms(tenantId, userId), async () => {
    const mods = await enabledModules(tenantId);
    let q = db('permissions as p').select('p.code');
    if (!isOwner) {
      q = q.join('role_permissions as rp', 'rp.permission_id', 'p.id')
        .join('user_roles as ur', function () {
          this.on('ur.role_id', '=', 'rp.role_id').andOn('ur.tenant_id', '=', 'rp.tenant_id');
        })
        .where('ur.tenant_id', tenantId)
        .where('ur.user_id', userId);
    }
    const rows = await q.where((w) => w.whereNull('p.module_code').orWhereIn('p.module_code', mods)).distinct();
    return rows.map((r: any) => r.code);
  }, { ttlSec: 300, l1TtlMs: 15_000 });
}

export interface MenuNode {
  id: number; code: string; label: string; icon: string | null; route: string;
  sortOrder: number; children: MenuNode[];
}

/**
 * GET /api/me/menus — only menus whose permission the user has (PDF §5.2),
 * using the client's renamed labels, hidden flags and drag & drop order.
 */
export async function userMenus(tenantId: number, userId: number, isOwner: boolean): Promise<MenuNode[]> {
  return cached(keys.menus(tenantId, userId), async () => {
    const [perms, mods] = await Promise.all([userPermissions(tenantId, userId, isOwner), enabledModules(tenantId)]);
    const all = await menuItemsForTenant(tenantId);
    const allowed = all.filter((m) =>
      !m.isHidden &&
      (!m.moduleCode || mods.includes(m.moduleCode)) &&
      (!m.permissionCode || perms.includes(m.permissionCode)));
    return buildTree(allowed).filter((n) => n.route || n.children.length > 0);
  }, { ttlSec: 300, l1TtlMs: 15_000 });
}

export interface MenuItemRow {
  id: number; code: string; parentId: number | null; label: string; defaultLabel: string; customLabel: string | null;
  icon: string | null; route: string; permissionCode: string | null; moduleCode: string | null;
  isHidden: boolean; sortOrder: number;
}

export async function menuItemsForTenant(tenantId: number): Promise<MenuItemRow[]> {
  const rows = await db('menu_templates as mt')
    .leftJoin('tenant_menus as tm', function () {
      this.on('tm.menu_template_id', '=', 'mt.id').andOn('tm.tenant_id', '=', db.raw('?', [tenantId]));
    })
    .select('mt.id', 'mt.code', 'mt.parent_id', 'mt.default_label', 'mt.icon', 'mt.route', 'mt.permission_code',
      'mt.module_code', 'mt.default_sort', 'tm.custom_label', 'tm.is_hidden', 'tm.sort_order');
  return rows
    .map((r: any) => ({
      id: Number(r.id), code: r.code, parentId: r.parent_id ? Number(r.parent_id) : null,
      label: r.custom_label || r.default_label, defaultLabel: r.default_label, customLabel: r.custom_label ?? null,
      icon: r.icon, route: r.route, permissionCode: r.permission_code, moduleCode: r.module_code,
      isHidden: !!r.is_hidden, sortOrder: r.sort_order ?? r.default_sort,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function buildTree(items: MenuItemRow[]): MenuNode[] {
  const byParent = new Map<number | null, MenuItemRow[]>();
  for (const i of items) {
    const list = byParent.get(i.parentId) ?? [];
    list.push(i);
    byParent.set(i.parentId, list);
  }
  const build = (parent: number | null): MenuNode[] =>
    (byParent.get(parent) ?? []).map((i) => ({
      id: i.id, code: i.code, label: i.label, icon: i.icon, route: i.route, sortOrder: i.sortOrder,
      children: build(i.id),
    }));
  return build(null);
}

/** Role/permission/menu change -> drop every cached ACL entry of the shop (all instances). */
export const invalidateAcl = (tenantId: number) => invalidate(keys.acl(tenantId));

// ----------------------------------------------------------------- limits
export interface EffectiveLimits { maxProducts: number | null; maxStaff: number | null; maxStorageMb: number | null }

export async function effectiveLimits(tenantId: number): Promise<EffectiveLimits> {
  return cached(keys.limits(tenantId), async () => {
    const r = await db('tenants as t')
      .join('plans as p', 'p.id', 't.plan_id')
      .leftJoin('tenant_limits as l', 'l.tenant_id', 't.id')
      .where('t.id', tenantId)
      .first('p.max_products', 'p.max_staff', 'p.max_storage_mb',
        'l.max_products as o_products', 'l.max_staff as o_staff', 'l.max_storage_mb as o_storage');
    return {
      maxProducts: r.o_products ?? r.max_products,
      maxStaff: r.o_staff ?? r.max_staff,
      maxStorageMb: r.o_storage ?? r.max_storage_mb,
    };
  });
}

export async function assertProductLimit(tenantId: number) {
  const { maxProducts } = await effectiveLimits(tenantId);
  if (maxProducts == null) return;
  const [{ c }] = await db('products').where({ tenant_id: tenantId }).whereNot('status', 'ARCHIVED').count({ c: '*' });
  if (Number(c) >= maxProducts) throw limitReached(`Your plan allows ${maxProducts} products. Upgrade to add more.`);
}

export async function assertStaffLimit(tenantId: number) {
  const { maxStaff } = await effectiveLimits(tenantId);
  if (maxStaff == null) return;
  const [{ c }] = await db('users').where({ tenant_id: tenantId, is_owner: 0 }).whereNot('status', 'DISABLED').count({ c: '*' });
  if (Number(c) >= maxStaff) throw limitReached(`Your plan allows ${maxStaff} staff users. Upgrade to add more.`);
}

export async function assertStorageLimit(tenantId: number, addBytes: number) {
  const { maxStorageMb } = await effectiveLimits(tenantId);
  if (maxStorageMb == null) return;
  const [{ s }] = await db('media_files').where({ tenant_id: tenantId }).sum({ s: 'size_bytes' });
  if (Number(s || 0) + addBytes > maxStorageMb * 1024 * 1024) {
    throw limitReached(`Storage limit of ${maxStorageMb} MB reached.`);
  }
}
