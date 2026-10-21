import crypto from 'node:crypto';
import { env } from '../config/env';

const KEY = Buffer.from(env.ENCRYPTION_KEY, 'base64');
if (KEY.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes base64');

/** AES-256-GCM. Output = iv(12) | tag(16) | ciphertext */
export function encrypt(plain: string): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}
export function decrypt(buf: Buffer | null | undefined): string | null {
  if (!buf) return null;
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const hmacSha256 = (secret: string, data: string) =>
  crypto.createHmac('sha256', secret).update(data).digest('hex');
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
