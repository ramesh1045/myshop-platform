import { Router } from 'express';
import { isServedDomain } from '../../services/domain.service';
import { env } from '../../config/env';

export const internalRouter = Router();

/**
 * Caddy on-demand TLS "ask" endpoint (PDF §2, §6): Caddy calls
 *   GET /api/internal/domain-check?domain=kavyatextiles.com
 * before issuing a certificate. 200 = issue, anything else = refuse.
 */
internalRouter.get('/domain-check', async (req, res) => {
  if (env.INTERNAL_SECRET && req.query.secret !== env.INTERNAL_SECRET) return res.status(403).end();
  const ok = await isServedDomain(String(req.query.domain || ''));
  res.status(ok ? 200 : 404).end();
});
