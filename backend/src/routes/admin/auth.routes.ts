/**
 * Store Owner & Staff login at kavya.myshop.com/admin (PDF §4), staff invitation accept (PDF §5.3),
 * GET /api/me and GET /api/me/menus (PDF §5.2)
 */
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '../../db/knex';
import { tq } from '../../db/tenant-scope';
import { currentAuth, currentTenant, ctx } from '../../context/request-context';
import { body, rateLimit } from '../../middleware/common';
import { requireAuth } from '../../middleware/auth';
import { issueRefresh, revokeRefresh, rotateRefresh, signAccess } from '../../lib/jwt';
import { HttpError } from '../../lib/http-error';
import { randomToken, sha256 } from '../../lib/crypto';
import { audit } from '../../lib/audit';
import { enabledModules, invalidateAcl, userMenus, userPermissions } from '../../services/access.service';
import { sendEmail } from '../../lib/queue';
import { publicUrl } from '../../config/env';

export const adminAuthRouter = Router();

async function issueUserTokens(user: { id: number; is_owner: boolean }) {
  const t = currentTenant();
  return {
    accessToken: signAccess({ sub: String(user.id), typ: 'USER', tid: t.id, own: !!user.is_owner }),
    refreshToken: await issueRefresh('USER', Number(user.id), t.id, ctx()?.ip),
  };
}

adminAuthRouter.post('/login', rateLimit('admin-login', 10, 60), body(z.object({
  email: z.string().email(), password: z.string().min(1),
})), async (req, res) => {
  const u = await tq('users').where({ email: req.body.email.toLowerCase() }).first();
  if (!u || !u.password_hash || !(await bcrypt.compare(req.body.password, u.password_hash))) {
    throw new HttpError(401, 'BAD_CREDENTIALS', 'Wrong email or password');
  }
  if (u.status !== 'ACTIVE') throw new HttpError(403, 'USER_DISABLED', 'Your account is not active');
  await tq('users').where({ id: u.id }).update({ last_login_at: new Date() });
  ctx()!.auth = { type: 'USER', id: Number(u.id), tenantId: currentTenant().id };
  await audit('LOGIN', 'user', u.id);
  res.json(await issueUserTokens(u));
});

adminAuthRouter.post('/refresh', body(z.object({ refreshToken: z.string() })), async (req, res) => {
  const t = currentTenant();
  const r = await rotateRefresh(req.body.refreshToken, 'USER', t.id);
  if (!r) throw new HttpError(401, 'REFRESH_INVALID', 'Please login again');
  const u = await tq('users').where({ id: r.subjectId, status: 'ACTIVE' }).first('id', 'is_owner');
  if (!u) throw new HttpError(401, 'USER_DISABLED', 'Account disabled');
  res.json({ accessToken: signAccess({ sub: String(u.id), typ: 'USER', tid: t.id, own: !!u.is_owner }), refreshToken: r.newToken });
});

adminAuthRouter.post('/logout', body(z.object({ refreshToken: z.string() })), async (req, res) => {
  await revokeRefresh(req.body.refreshToken);
  res.status(204).end();
});

/** Staff invitation link -> set password (PDF §5.3) */
adminAuthRouter.get('/invitation', async (req, res) => {
  const inv = await tq('user_invitations as i').join('users as u', 'u.id', 'i.user_id')
    .where('i.token_hash', sha256(String(req.query.token || ''))).whereNull('i.accepted_at')
    .where('i.expires_at', '>', new Date()).first('u.email', 'u.name');
  if (!inv) throw new HttpError(400, 'INVITE_INVALID', 'Invitation link is invalid or expired');
  res.json(inv);
});

adminAuthRouter.post('/accept-invite', rateLimit('invite', 10, 600), body(z.object({
  token: z.string().min(10), password: z.string().min(8).max(100), name: z.string().min(2).max(120).optional(),
})), async (req, res) => {
  const t = currentTenant();
  const user = await db.transaction(async (trx) => {
    const inv = await tq('user_invitations', trx).where({ token_hash: sha256(req.body.token) }).whereNull('accepted_at')
      .where('expires_at', '>', new Date()).forUpdate().first();
    if (!inv) throw new HttpError(400, 'INVITE_INVALID', 'Invitation link is invalid or expired');
    await tq('user_invitations', trx).where({ id: inv.id }).update({ accepted_at: new Date() });
    const patch: Record<string, unknown> = { password_hash: await bcrypt.hash(req.body.password, 12), status: 'ACTIVE' };
    if (req.body.name) patch.name = req.body.name;
    await tq('users', trx).where({ id: inv.user_id }).update(patch);
    return (await tq('users', trx).where({ id: inv.user_id }).first('id', 'is_owner')) as { id: number; is_owner: boolean };
  });
  await invalidateAcl(t.id);
  res.json(await issueUserTokens(user));
});

adminAuthRouter.post('/forgot-password', rateLimit('forgot', 5, 3600), body(z.object({ email: z.string().email() })), async (req, res) => {
  const t = currentTenant();
  const u = await tq('users').where({ email: req.body.email.toLowerCase(), status: 'ACTIVE' }).first();
  if (u) {
    const token = randomToken();
    await db('password_resets').insert({ subject_type: 'USER', subject_id: u.id, tenant_id: t.id, token_hash: sha256(token),
      expires_at: new Date(Date.now() + 3600_000) });
    await sendEmail({ tenantId: t.id, to: u.email, template: 'password_reset', subject: 'Reset your password',
      payload: { link: publicUrl(t.primaryDomain, `/admin/reset-password?token=${token}`) } });
  }
  res.json({ message: 'If the email exists, a reset link has been sent.' });
});

adminAuthRouter.post('/reset-password', body(z.object({ token: z.string(), password: z.string().min(8).max(100) })), async (req, res) => {
  const t = currentTenant();
  const r = await db('password_resets').where({ token_hash: sha256(req.body.token), subject_type: 'USER', tenant_id: t.id })
    .whereNull('used_at').where('expires_at', '>', new Date()).first();
  if (!r) throw new HttpError(400, 'RESET_INVALID', 'Reset link is invalid or expired');
  await tq('users').where({ id: r.subject_id }).update({ password_hash: await bcrypt.hash(req.body.password, 12) });
  await db('password_resets').where({ id: r.id }).update({ used_at: new Date() });
  await db('refresh_tokens').where({ subject_type: 'USER', subject_id: r.subject_id, tenant_id: t.id }).update({ revoked_at: new Date() });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ /api/me
export const meRouter = Router();
meRouter.use(requireAuth('USER'));

meRouter.get('/', async (_req, res) => {
  const a = currentAuth();
  const t = currentTenant();
  const [u, perms, mods, plan] = await Promise.all([
    tq('users').where({ id: a.id }).first('id', 'name', 'email', 'mobile', 'is_owner'),
    userPermissions(t.id, a.id, !!a.isOwner),
    enabledModules(t.id),
    db('tenants as t').join('plans as p', 'p.id', 't.plan_id').where('t.id', t.id).first('p.code', 'p.name', 't.status', 't.trial_ends_at'),
  ]);
  res.json({
    user: u, permissions: perms, modules: mods, impersonatedBy: a.impersonatorId ?? null,
    store: { name: t.name, subdomain: t.subdomain, primaryDomain: t.primaryDomain, status: plan.status,
      trialEndsAt: plan.trial_ends_at, plan: { code: plan.code, name: plan.name } },
  });
});

/** PDF §5.2: only the menus whose permission the user has */
meRouter.get('/menus', async (_req, res) => {
  const a = currentAuth();
  res.json(await userMenus(currentTenant().id, a.id, !!a.isOwner));
});

meRouter.put('/password', body(z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(100) })), async (req, res) => {
  const u = await tq('users').where({ id: currentAuth().id }).first();
  if (!(await bcrypt.compare(req.body.currentPassword, u.password_hash))) throw new HttpError(400, 'BAD_PASSWORD', 'Current password is wrong');
  await tq('users').where({ id: u.id }).update({ password_hash: await bcrypt.hash(req.body.newPassword, 12) });
  res.json({ ok: true });
});
