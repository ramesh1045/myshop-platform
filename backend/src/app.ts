import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from './lib/logger';
import { tenantFilter, onlySurface } from './middleware/tenant';
import { requireAuth, blockIfSuspended } from './middleware/auth';
import { errorHandler } from './middleware/common';
import { LOCAL_UPLOAD_DIR } from './lib/storage';
import { db } from './db/knex';
import { redis } from './cache/cache';

import { storefrontRouter } from './routes/public/storefront.routes';
import { signupRouter, platformWebhookRouter } from './routes/public/signup.routes';
import { customerRouter } from './routes/customer/customer.routes';
import { adminAuthRouter, meRouter } from './routes/admin/auth.routes';
import { catalogRouter } from './routes/admin/catalog.routes';
import { ordersRouter } from './routes/admin/orders.routes';
import { accessRouter } from './routes/admin/access.routes';
import { brandingRouter } from './routes/admin/branding.routes';
import { settingsRouter } from './routes/admin/settings.routes';
import { billingRouter } from './routes/admin/billing.routes';
import { platformRouter } from './routes/platform/platform.routes';
import { headlessRouter } from './routes/headless/headless.routes';
import { internalRouter } from './routes/internal/internal.routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', true); // behind Caddy — req.hostname / req.ip come from X-Forwarded-*
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  // keep the raw body for Razorpay webhook signature verification
  app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));

  app.get('/api/health', async (_req, res) => {
    const [dbOk, redisOk] = await Promise.all([
      db.raw('SELECT 1').then(() => true).catch(() => false),
      redis.ping().then(() => true).catch(() => false),
    ]);
    res.status(dbOk && redisOk ? 200 : 503).json({ status: dbOk && redisOk ? 'ok' : 'degraded', db: dbOk, redis: redisOk });
  });

  app.use('/uploads', express.static(LOCAL_UPLOAD_DIR, { maxAge: '30d', immutable: true }));

  // Host header -> tenant (TenantFilter)
  app.use(tenantFilter);

  app.use('/api/internal', internalRouter);
  app.use('/api/headless', cors(), headlessRouter);
  app.use('/api/webhooks', platformWebhookRouter);

  // myshop.com — marketing + signup
  app.use('/api/signup', onlySurface('MARKETING'), signupRouter);
  // admin.myshop.com — Super Admin
  app.use('/api/platform', onlySurface('PLATFORM_ADMIN'), platformRouter);
  // kavya.myshop.com — storefront, customer, store admin
  app.use('/api/public', onlySurface('STORE'), storefrontRouter);
  app.use('/api/customer', onlySurface('STORE'), customerRouter);
  app.use('/api/admin/auth', onlySurface('STORE'), adminAuthRouter);
  app.use('/api/me', onlySurface('STORE'), meRouter);

  const admin = express.Router();
  admin.use(requireAuth('USER'), blockIfSuspended);
  admin.use('/billing', billingRouter);
  admin.use(catalogRouter, ordersRouter, accessRouter, brandingRouter, settingsRouter);
  app.use('/api/admin', onlySurface('STORE'), admin);

  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));
  app.use(errorHandler);
  return app;
}
