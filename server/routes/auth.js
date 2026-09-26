import { Router, readBody } from '../http/router.js';
import { setCookie, clearCookie } from '../http/respond.js';
import { sign, verify } from '../lib/jwt.js';
import * as users from '../models/users.js';
import * as v from '../lib/validate.js';
import HttpError from '../lib/http-error.js';
import { createRateLimiter } from '../lib/rate-limit.js';
import { track } from '../models/seed.js';
import config from '../config.js';
import { get, run, getSetting, setSetting } from '../db.js';
import { createSession, revokeSession } from '../lib/session.js';
import { earn } from '../models/points.js';

/** 可选的商城皮肤（与 public/js/lib/store.js 的 SKINS 保持一致） */
const SHOP_SKINS = ['ocean', 'forest', 'sunset', 'mono'];

const router = new Router();
const authLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

function issue(ctx, user) {
  const sid = createSession(user.id, { userAgent: ctx.headers['user-agent'], ip: ctx.ip });
  const token = sign({
    sub: user.id,
    sid,
    role: user.role,
    name: user.username,
    nick: user.nickname || user.username,
  });
  setCookie(ctx.res, config.auth.cookie, token, { maxAge: config.auth.tokenTtlSec });
  return token;
}

router.use(async (ctx) => {
  const parsed = await readBody(ctx.req);
  ctx.body = parsed.body;
  ctx.files = parsed.files;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.method)) authLimiter(ctx.req);
});

router.post('/register', async (ctx) => {
  const username = v.username(ctx.body.username);
  const email = v.email(ctx.body.email);
  const password = v.str(ctx.body.password, '密码', { min: 6, max: 128, trim: false });
  if (password.length < 6) throw HttpError.badRequest('密码至少 6 位');
  const nickname = v.str(ctx.body.nickname, '昵称', { required: false, max: 24 }) || username;
  const isFirst = !get('SELECT id FROM users LIMIT 1');
  let user = users.create({ username, email, password, nickname, role: isFirst ? 'admin' : 'user' });
  track('register', { userId: user.id });
  const reward = earn(user.id, 'register');
  user = users.findById(user.id); // 回读以带上最新积分
  const token = issue(ctx, user);
  ctx.created({ user, token, reward });
});

router.post('/login', async (ctx) => {
  const login = v.str(ctx.body.login || ctx.body.username || ctx.body.email, '账号', { max: 200 });
  const password = v.str(ctx.body.password, '密码', { max: 128, trim: false });
  const user = users.authenticate(login, password);
  if (!user) {
    track('login_failed', { meta: { login } });
    throw HttpError.unauthorized('账号或密码不正确');
  }
  const token = issue(ctx, user);
  track('login', { userId: user.id });
  ctx.ok({ user, token });
});

router.post('/logout', async (ctx) => {
  revokeSession(ctx.user?.sid);
  clearCookie(ctx.res, config.auth.cookie);
  track('logout', { userId: ctx.user?.id });
  ctx.ok({ ok: true, message: '已退出登录' });
});

router.get('/me', async (ctx) => {
  if (!ctx.user) return ctx.ok({ user: null });
  const user = users.findById(ctx.user.id);
  if (!user) return ctx.ok({ user: null });
  ctx.ok({
    user,
    stats: {
      unread: get(
        "SELECT COUNT(*) AS c FROM comments WHERE author_id = ? AND status='published' AND created_at > datetime('now','-1 day')",
        [user.id],
      ).c,
    },
  });
});

router.patch('/me', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const patch = {};
  if (ctx.body.nickname !== undefined) patch.nickname = v.str(ctx.body.nickname, '昵称', { max: 24 });
  if (ctx.body.bio !== undefined) patch.bio = v.str(ctx.body.bio, '简介', { required: false, max: 300 });
  if (ctx.body.website !== undefined) patch.website = v.url(ctx.body.website, '个人网站', { required: false });
  if (ctx.body.location !== undefined) patch.location = v.str(ctx.body.location, '所在地', { required: false, max: 60 });
  if (ctx.body.theme !== undefined) patch.theme = v.oneOf(ctx.body.theme, '主题', ['light', 'dark', 'system'], 'system');
  if (ctx.body.skin !== undefined) patch.skin = ctx.body.skin ? v.oneOf(ctx.body.skin, '皮肤', SHOP_SKINS) : '';
  if (ctx.body.avatarColor !== undefined) patch.avatarColor = v.str(ctx.body.avatarColor, '主题色', { max: 20 });
  if (ctx.body.username !== undefined) patch.username = v.username(ctx.body.username);
  if (ctx.body.email !== undefined) patch.email = v.email(ctx.body.email);
  if (ctx.body.password !== undefined) {
    const current = v.str(ctx.body.currentPassword, '当前密码', { max: 128, trim: false });
    const row = users.findFull(ctx.user.id);
    const { verifyPassword } = await import('../lib/password.js');
    if (!verifyPassword(current, row.password)) throw HttpError.badRequest('当前密码不正确');
    patch.password = v.str(ctx.body.password, '新密码', { min: 6, max: 128, trim: false });
  }
  const user = users.updateProfile(ctx.user.id, patch);
  track('profile_update', { userId: user.id });
  // 资料一次性奖励：头像色之外再填昵称与简介即可拿满
  const full = users.findFull(user.id);
  const complete = !!(full.nickname && full.bio && full.avatar_color);
  const reward = complete ? earn(user.id, 'complete_profile') : null;
  ctx.ok({ user, reward });
});

router.get('/sessions', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const rows = (await import('../db.js')).all(
    'SELECT id, user_agent, ip, created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
    [ctx.user.id],
  );
  ctx.ok({ items: rows });
});

router.delete('/sessions/:id', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  run('DELETE FROM sessions WHERE id = ? AND user_id = ?', [ctx.params.id, ctx.user.id]);
  ctx.ok({ ok: true });
});

/** 密码强度评估（前端注册页实时调用） */
router.get('/password-score', async (ctx) => {
  const score = (await import('../lib/password.js')).passwordScore(String(ctx.query.password || ''));
  ctx.ok({ score });
});

/** 站点设置（公开部分） */
router.get('/settings', async (ctx) => {
  const keys = ['site_name', 'site_tagline', 'site_description', 'icp', 'footer_text', 'allow_registration'];
  const out = {};
  for (const k of keys) {
    const v = getSetting(k);
    if (v !== null) out[k] = v;
  }
  ctx.ok({
    settings: {
      site_name: out.site_name || config.site.name,
      site_tagline: out.site_tagline || config.site.tagline,
      site_description: out.site_description || 'Node.js 全栈综合站点',
      icp: out.icp || '',
      footer_text: out.footer_text || '由 Node.js 驱动 · 零第三方依赖',
      allow_registration: out.allow_registration ?? true,
    },
  });
});

router.patch('/settings', async (ctx) => {
  if (ctx.user?.role !== 'admin') throw HttpError.forbidden('仅管理员可修改站点设置');
  const allowed = ['site_name', 'site_tagline', 'site_description', 'icp', 'footer_text', 'allow_registration'];
  for (const key of allowed) {
    if (ctx.body[key] !== undefined) setSetting(key, ctx.body[key]);
  }
  ctx.ok({ ok: true });
});

export default router;
export { verify };
