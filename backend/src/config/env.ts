import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  PLATFORM_DOMAIN: z.string().default('localhost'),
  CNAME_TARGET: z.string().default('stores.myshop.com'),
  SERVER_IP: z.string().optional().default(''),
  PUBLIC_SCHEME: z.enum(['http', 'https']).default('https'),
  FRONTEND_PORT: z.string().optional().default(''),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().default(3306),
  DB_USER: z.string().default('myshop'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('myshop'),
  DB_POOL_MAX: z.coerce.number().default(20),

  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  ENCRYPTION_KEY: z.string(),
  INTERNAL_SECRET: z.string().default(''),

  PLATFORM_RAZORPAY_KEY_ID: z.string().optional().default(''),
  PLATFORM_RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  PLATFORM_RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),

  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional().default(''),
  S3_ACCESS_KEY: z.string().optional().default(''),
  S3_SECRET_KEY: z.string().optional().default(''),
  CDN_BASE_URL: z.string().optional().default(''),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().default('MyShop <no-reply@myshop.com>'),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';

/** Public URL for a host, e.g. storeUrl('kavya.myshop.com', '/admin') */
export function publicUrl(host: string, path = '/'): string {
  const port = !isProd && env.FRONTEND_PORT ? `:${env.FRONTEND_PORT}` : '';
  return `${env.PUBLIC_SCHEME}://${host}${port}${path}`;
}
export const adminHost = () => `admin.${env.PLATFORM_DOMAIN}`;
export const subdomainHost = (sub: string) => `${sub}.${env.PLATFORM_DOMAIN}`;
