import type { NextFunction, Request, Response } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { HttpError } from '../lib/http-error';
import { redis } from '../cache/cache';
import { logger } from '../lib/logger';
import { ctx } from '../context/request-context';

/** Validate req.body with zod and replace it with the parsed value */
export const body = (schema: ZodSchema) => (req: Request, _res: Response, next: NextFunction) => {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) return next(new HttpError(422, 'VALIDATION_ERROR', 'Please check the highlighted fields', r.error.flatten()));
  req.body = r.data;
  next();
};

/**
 * Redis fixed-window rate limiter (PDF §8 "rate limit counters" in Redis).
 * Shared across all API instances.
 */
export const rateLimit = (name: string, max: number, windowSec: number) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const t = ctx()?.tenant?.id ?? 0;
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const key = `rl:${name}:${t}:${req.ip}:${bucket}`;
    try {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, windowSec);
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - n));
      if (n > max) return next(new HttpError(429, 'RATE_LIMITED', 'Too many requests, please slow down'));
    } catch (e) {
      logger.warn({ err: e }, 'rate limiter unavailable');
    }
    next();
  };

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.flatten() } });
  }
  if (err?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with the same value already exists' } });
  }
  if (err?.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: { code: 'IN_USE', message: 'This record is in use and cannot be deleted' } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON' } });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'File too large' } });
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
}
