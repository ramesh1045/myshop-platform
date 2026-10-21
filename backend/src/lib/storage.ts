/**
 * S3-compatible object storage + CDN (PDF §6, §11). Images are never stored on the API
 * server, so the API stays stateless and can run as many copies as needed (PDF §7).
 * Dev fallback: when S3_BUCKET is empty files go to ./uploads and are served at /uploads.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';
import { randomToken } from './crypto';

const s3 = env.S3_BUCKET
  ? new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: !!env.S3_ENDPOINT,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  })
  : null;

export const LOCAL_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

export async function putObject(tenantUuid: string, originalName: string, mime: string, data: Buffer) {
  const ext = (path.extname(originalName) || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6);
  const key = `t/${tenantUuid}/${new Date().toISOString().slice(0, 7)}/${randomToken(12)}${ext}`;
  if (s3) {
    await s3.send(new PutObjectCommand({
      Bucket: env.S3_BUCKET, Key: key, Body: data, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable',
    }));
    const base = env.CDN_BASE_URL || `${env.S3_ENDPOINT}/${env.S3_BUCKET}`;
    return { key, url: `${base.replace(/\/$/, '')}/${key}` };
  }
  const full = path.join(LOCAL_UPLOAD_DIR, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return { key, url: `/uploads/${key}` };
}

export async function deleteObject(key: string) {
  if (s3) await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  else await fs.rm(path.join(LOCAL_UPLOAD_DIR, key), { force: true });
}
