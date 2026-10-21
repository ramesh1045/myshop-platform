import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { db } from '../db/knex';
import { randomToken, sha256 } from './crypto';

export type TokenType = 'PLATFORM' | 'USER' | 'CUSTOMER' | 'PREVIEW';

export interface AccessClaims {
  sub: string;           // subject id
  typ: TokenType;
  tid?: number;          // tenant id — must equal the tenant resolved from Host (PDF §6)
  own?: boolean;         // store owner
  imp?: number;          // impersonating platform user id
}

export function signAccess(claims: AccessClaims, ttl: string = env.JWT_ACCESS_TTL): string {
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: ttl as any, issuer: 'myshop' });
}
export function verifyAccess(token: string): AccessClaims {
  return jwt.verify(token, env.JWT_SECRET, { issuer: 'myshop' }) as AccessClaims;
}

/** Opaque refresh token stored hashed in refresh_tokens (rotated on every use). */
export async function issueRefresh(subjectType: 'PLATFORM' | 'USER' | 'CUSTOMER', subjectId: number,
  tenantId: number | null, ip?: string): Promise<string> {
  const token = randomToken(48);
  await db('refresh_tokens').insert({
    subject_type: subjectType, subject_id: subjectId, tenant_id: tenantId,
    token_hash: sha256(token), created_ip: ip ?? null,
    expires_at: new Date(Date.now() + env.REFRESH_TTL_DAYS * 86400_000),
  });
  return token;
}

export async function rotateRefresh(token: string, subjectType: 'PLATFORM' | 'USER' | 'CUSTOMER',
  tenantId: number | null): Promise<{ subjectId: number; newToken: string } | null> {
  const row = await db('refresh_tokens').where({ token_hash: sha256(token), subject_type: subjectType }).first();
  if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) return null;
  if ((row.tenant_id ?? null) !== (tenantId ?? null)) return null; // refresh token of shop A cannot be used on shop B
  await db('refresh_tokens').where({ id: row.id }).update({ revoked_at: new Date() });
  const newToken = await issueRefresh(subjectType, Number(row.subject_id), tenantId);
  return { subjectId: Number(row.subject_id), newToken };
}

export async function revokeRefresh(token: string) {
  await db('refresh_tokens').where({ token_hash: sha256(token) }).update({ revoked_at: new Date() });
}
