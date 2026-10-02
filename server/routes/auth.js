import { hashPassword, verifyPassword, scorePassword } from '../lib/password.js';
import { issueToken, sessionCookie, clearSessionCookie, verifySessionToken, readToken } from '../lib/session.js';
import { badRequest, conflict, unauthorized, tooMany, notFound, forbidden } from '../lib/http-error.js';
import { createLimiter } from '../lib/rate-limit.js';
import { email as vEmail, username as vUsername, password as vPassword, str, oneOf, THEMES, accent, int, logEvent } from '../lib/validate.js';
import * as users from '../models/users.js';
import { getSettings } from '../models/stats.js';

const authLimiter = createLimiter({ windowMs: 60_000, max: 20, name: 'auth' });

function clientInfo(ctx) {
  return {
    userAgent: ctx.req.headers['user-agent'] || '',
    ip: ctx.clientIp,
  };
}

/** 从请求中解析当前用户（无效令牌视为未登录）。 */
export function resolveUser(req, cookies) {
  const claims = verifySessionToken(readToken(req.headers, cookies));
  if (!claims) return null;
  const session = users.findSession(claims.sessionId);
  if (!session || session.userId !== claims.userId) return null;
  const user = users.findById(session.userId);
  if (!user) return null;
  users.touchSession(session.id);
  return { user, sessionId: session.id };
}

export function register(router) {
  router.get('/api/auth/password-score', async (ctx) => {
    ctx.json(200, scorePassword(ctx.query.password ?? ''));
  });

  router.post('/api/auth/register', async (ctx) => {
    if (authLimiter.take(ctx.clientIp)) throw tooMany('尝试次数过多，请 1 分钟后再试');
    if (getSettings().allow_registration !== 'true') throw forbidden('本站已关闭注册');

    const body = await ctx.input();
    const mail = vEmail(body.email);
    const name = vUsername(body.username);
    const secret = vPassword(body.password);

    if (users.emailTaken(mail)) throw conflict('该邮箱已被注册');
    if (users.usernameTaken(name)) throw conflict('该用户名已被占用');

    const user = users.createUser({
      email: mail,
      username: name,
      nickname: str(body.nickname, '昵称', { max: 24, required: false, fallback: name }),
      passwordHash: hashPassword(secret),
    });
    logEvent(user.id, 'user.register', '注册账号');

    const session = users.createSession(user.id, clientInfo(ctx));
    const token = issueToken({ uid: user.id, sid: session.id });
    ctx.setCookie(sessionCookie(token));
    ctx.json(201, { user: users.toPublic(user), token });
  });

  router.post('/api/auth/login', async (ctx) => {
    if (authLimiter.take(ctx.clientIp)) throw tooMany('尝试次数过多，请 1 分钟后再试');
    const body = await ctx.input();
    const mail = vEmail(body.email, '邮箱').toLowerCase();
    const account = users.findByEmail(mail);
    const ok = account && verifyPassword(String(body.password ?? ''), account.password_hash);
    if (!ok) throw unauthorized('邮箱或密码不正确');

    const session = users.createSession(account.id, clientInfo(ctx));
    const token = issueToken({ uid: account.id, sid: session.id });
    logEvent(account.id, 'user.login', '登录');
    ctx.setCookie(sessionCookie(token));
    ctx.json(200, { user: users.toPublic(users.findById(account.id)), token });
  });

  router.post('/api/auth/logout', async (ctx) => {
    const auth = ctx.auth;
    if (auth) {
      users.deleteSession(auth.sessionId);
      logEvent(auth.user.id, 'user.logout', '退出登录');
    }
    ctx.setCookie(clearSessionCookie());
    ctx.json(200, { ok: true });
  });

  router.get('/api/auth/me', async (ctx) => {
    if (!ctx.auth) return ctx.json(200, { user: null });
    return ctx.json(200, { user: users.toPublic(ctx.auth.user), sessionId: ctx.auth.sessionId });
  });

  router.patch('/api/auth/me', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    const patch = {};

    if (body.nickname !== undefined) patch.nickname = str(body.nickname, '昵称', { max: 24 });
    if (body.bio !== undefined) patch.bio = str(body.bio, '简介', { max: 200, required: false, fallback: '' });
    if (body.theme !== undefined) patch.theme = oneOf(body.theme, '主题', THEMES);
    if (body.accent !== undefined) patch.accent = accent(body.accent);
    if (body.avatarHue !== undefined) patch.avatarHue = int(body.avatarHue, '头像色相', { min: 0, max: 359 });
    if (body.username !== undefined) {
      const name = vUsername(body.username);
      if (users.usernameTaken(name, user.id)) throw conflict('该用户名已被占用');
      patch.username = name;
    }

    const updated = users.updateProfile(user.id, patch);
    ctx.json(200, { user: users.toPublic(updated) });
  });

  router.post('/api/auth/password', async (ctx) => {
    const user = ctx.requireUser();
    if (authLimiter.take(`pw:${user.id}`)) throw tooMany('修改过于频繁，请稍后再试');
    const body = await ctx.input();
    const account = users.findByEmail(user.email);
    if (!verifyPassword(String(body.current ?? ''), account.password_hash)) throw badRequest('当前密码不正确');

    users.setPassword(user.id, hashPassword(vPassword(body.next)));
    // 改密后吊销其它会话，保留当前登录
    users.deleteUserSessions(user.id, ctx.auth.sessionId);
    logEvent(user.id, 'user.password', '修改密码');
    ctx.json(200, { ok: true });
  });

  router.get('/api/auth/sessions', async (ctx) => {
    const user = ctx.requireUser();
    ctx.json(200, { items: users.listSessions(user.id), current: ctx.auth.sessionId });
  });

  router.delete('/api/auth/sessions/:id', async (ctx) => {
    const user = ctx.requireUser();
    const target = ctx.params.id;
    const session = users.findSession(target);
    if (!session || session.userId !== user.id) throw notFound('会话不存在');
    if (target === ctx.auth.sessionId) {
      users.deleteSession(target);
      ctx.setCookie(clearSessionCookie());
    } else {
      users.deleteSession(target);
    }
    ctx.json(200, { ok: true });
  });
}
