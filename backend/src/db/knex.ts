import knexFactory, { Knex } from 'knex';
import { env, isProd } from '../config/env';
import { ctx } from '../context/request-context';
import { logger } from '../lib/logger';

export const db: Knex = knexFactory({
  client: 'mysql2',
  connection: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    charset: 'utf8mb4',
    timezone: 'Z',
    decimalNumbers: true,
    supportBigNumbers: true,
    dateStrings: false,
    // TINYINT(1) -> boolean
    typeCast(field: any, next: () => unknown) {
      if (field.type === 'TINY' && field.length === 1) {
        const v = field.string();
        return v === null ? null : v === '1';
      }
      return next();
    },
  } as Knex.MySql2ConnectionConfig,
  pool: { min: 0, max: env.DB_POOL_MAX },
});

/**
 * Tables that carry tenant_id. Every store-side query MUST go through tq()/tinsert(),
 * which is the Node.js equivalent of Hibernate 6 @TenantId (PDF §6).
 */
export const TENANT_TABLES = new Set([
  'tenant_domains', 'tenant_settings', 'tenant_limits', 'tenant_modules', 'subscriptions', 'tenant_counters',
  'users', 'roles', 'role_permissions', 'user_roles', 'user_invitations', 'tenant_menus', 'audit_logs', 'api_keys',
  'categories', 'products', 'product_images', 'customers', 'customer_addresses', 'coupons', 'orders', 'order_items',
  'order_status_history', 'payments', 'coupon_redemptions', 'media_files', 'tenant_theme_settings', 'tenant_themes',
  'pages', 'forms', 'form_submissions', 'blog_posts', 'booking_services', 'bookings', 'platform_invoices',
  'platform_payments', 'transaction_fees', 'service_requests', 'notifications', 'impersonation_sessions',
]);

/** Dev safety net: warn when a store request touches a tenant table without a tenant_id predicate. */
if (!isProd) {
  db.on('query', (q: { sql: string }) => {
    const c = ctx();
    if (!c || (c.surface !== 'STORE' && c.surface !== 'HEADLESS')) return;
    const sql = q.sql.toLowerCase();
    if (sql.startsWith('insert') || sql.includes('/* global */')) return; // explicit cross-tenant lookups
    const touched = [...sql.matchAll(/(?:from|join|update)\s+`?([a-z_]+)`?/g)].map((m) => m[1]);
    if (touched.some((t) => TENANT_TABLES.has(t)) && !sql.includes('tenant_id')) {
      logger.warn({ sql: q.sql }, 'TENANT GUARD: query on tenant table without tenant_id filter');
    }
  });
}
