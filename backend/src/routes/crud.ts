/**
 * Small generic tenant-scoped CRUD router used for simple resources
 * (coupons, blog posts, booking services, forms). All queries go through tq()/tinsert().
 */
import { Router } from 'express';
import { ZodObject, ZodRawShape } from 'zod';
import { db } from '../db/knex';
import { tq, tinsert, safePatch } from '../db/tenant-scope';
import { currentTenant } from '../context/request-context';
import { body } from '../middleware/common';
import { notFound } from '../lib/http-error';
import { offsetPaginate } from '../lib/pagination';
import { audit } from '../lib/audit';
import { uniqueSlug } from '../lib/util';

export interface CrudOptions {
  table: string;
  entity: string;
  schema: ZodObject<ZodRawShape>;
  /** map validated camelCase body -> db row */
  toRow: (b: any) => Record<string, unknown>;
  searchColumns?: string[];
  listColumns?: string[];
  slugFrom?: string; // db column used to build slug
  orderBy?: { column: string; order: 'asc' | 'desc' }[];
  beforeCreate?: (row: Record<string, unknown>) => Promise<void>;
  filters?: string[]; // allowed equality filters from query string
}

export function crudRouter(o: CrudOptions): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const q = tq(o.table).select(o.listColumns ?? ['*']);
    if (req.query.q && o.searchColumns?.length) {
      const term = `%${String(req.query.q)}%`;
      q.where((w) => o.searchColumns!.forEach((c) => w.orWhere(c, 'like', term)));
    }
    for (const f of o.filters ?? []) if (req.query[f] !== undefined && req.query[f] !== '') q.where(f, String(req.query[f]));
    res.json(await offsetPaginate(q, req, o.orderBy ?? [{ column: 'id', order: 'desc' }]));
  });

  r.get('/:id', async (req, res) => {
    const row = await tq(o.table).where({ id: Number(req.params.id) }).first();
    if (!row) throw notFound(o.entity);
    res.json(row);
  });

  r.post('/', body(o.schema), async (req, res) => {
    const t = currentTenant();
    const row = Object.fromEntries(Object.entries(o.toRow(req.body)).filter(([, v]) => v !== undefined));
    if (o.slugFrom) row.slug = await uniqueSlug(db, o.table, t.id, String(req.body.slug || row[o.slugFrom]));
    await o.beforeCreate?.(row);
    const id = await tinsert(o.table, row);
    await audit(`${o.entity.toUpperCase()}_CREATE`, o.entity, id, null, row);
    res.status(201).json(await tq(o.table).where({ id }).first());
  });

  r.put('/:id', body(o.schema.partial()), async (req, res) => {
    const t = currentTenant();
    const id = Number(req.params.id);
    const old = await tq(o.table).where({ id }).first();
    if (!old) throw notFound(o.entity);
    const patch = safePatch(o.toRow({ ...req.body }));
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
    if (o.slugFrom && req.body.slug) patch.slug = await uniqueSlug(db, o.table, t.id, String(req.body.slug), id);
    await tq(o.table).where({ id }).update(patch);
    await audit(`${o.entity.toUpperCase()}_UPDATE`, o.entity, id, old, patch);
    res.json(await tq(o.table).where({ id }).first());
  });

  r.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const n = await tq(o.table).where({ id }).delete();
    if (!n) throw notFound(o.entity);
    await audit(`${o.entity.toUpperCase()}_DELETE`, o.entity, id);
    res.status(204).end();
  });
  return r;
}
