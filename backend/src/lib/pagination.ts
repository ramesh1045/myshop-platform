/**
 * PDF §8 pagination:
 *   - Admin pages      -> OFFSET (page numbers + total count)
 *   - Storefront scroll, logs, APIs -> CURSOR (keyset) — no OFFSET scan, constant speed
 */
import type { Knex } from 'knex';
import type { Request } from 'express';

export interface OffsetPage<T> { items: T[]; page: number; size: number; total: number; totalPages: number }
export interface CursorPage<T> { items: T[]; nextCursor: string | null }

export function offsetParams(req: Request, maxSize = 100) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(req.query.size) || 20));
  return { page, size };
}

export async function offsetPaginate<T>(
  query: Knex.QueryBuilder, req: Request, orderBy: { column: string; order: 'asc' | 'desc' }[] = [],
): Promise<OffsetPage<T>> {
  const { page, size } = offsetParams(req);
  const countQ = query.clone().clearSelect().clearOrder().count({ c: '*' }).first();
  const [countRow, items] = await Promise.all([
    countQ,
    query.clone().orderBy(orderBy).limit(size).offset((page - 1) * size),
  ]);
  const total = Number((countRow as any)?.c ?? 0);
  return { items: items as T[], page, size, total, totalPages: Math.ceil(total / size) };
}

/** Keyset on a unique, monotonically increasing id column (descending = newest first). */
export async function cursorPaginate<T extends Record<string, any>>(
  query: Knex.QueryBuilder, req: Request, idColumn = 'id', maxSize = 50, idKey = 'id',
): Promise<CursorPage<T>> {
  const size = Math.min(maxSize, Math.max(1, Number(req.query.size) || 20));
  const cursor = req.query.cursor ? decodeCursor(String(req.query.cursor)) : null;
  const q = query.clone();
  if (cursor) q.where(idColumn, '<', cursor);
  const rows = (await q.orderBy(idColumn, 'desc').limit(size + 1)) as T[];
  const hasMore = rows.length > size;
  const items = hasMore ? rows.slice(0, size) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(Number(items[items.length - 1][idKey])) : null };
}

export const encodeCursor = (id: number) => Buffer.from(String(id)).toString('base64url');
export const decodeCursor = (c: string) => {
  const n = Number(Buffer.from(c, 'base64url').toString());
  return Number.isFinite(n) ? n : null;
};
