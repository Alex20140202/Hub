import { Router, readBody } from '../http/router.js';
import * as users from '../models/users.js';
import * as stats from '../models/stats.js';
import * as comments from '../models/comments.js';
import * as posts from '../models/posts.js';
import * as messages from '../models/messages.js';
import * as chat from '../models/chat.js';
import * as points from '../models/points.js';
import * as chatGateway from '../ws/chat.js';
import * as v from '../lib/validate.js';
import HttpError from '../lib/http-error.js';
import { track } from '../models/seed.js';
import { all, get, run, getSetting, setSetting } from '../db.js';
import { nowIso } from '../lib/id.js';

const router = new Router();

router.use(async (ctx) => {
  const parsed = await readBody(ctx.req);
  ctx.body = parsed.body;
});

/* ================= 公开统计 ================= */

router.get('/stats/overview', async (ctx) => {
  ctx.ok({
    ...stats.overview(),
    topPosts: stats.topPosts(5),
    tags: stats.popularTags(10),
    trend: stats.dailySeries(14),
    categories: posts.listCategories().slice(0, 6),
  });
});

router.get('/stats/dashboard', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  track('view_dashboard', { userId: ctx.user.id });
  ctx.ok(stats.dashboard(ctx.user.id));
});

router.get('/stats/trend', async (ctx) => {
  ctx.ok({
    trend: stats.dailySeries(v.int(ctx.query.days, '天数', { min: 3, max: 90, fallback: 14 })),
    hourly: stats.hourlyDistribution(),
  });
});

router.get('/stats/heatmap', async (ctx) => {
  ctx.ok({ items: stats.heatmap(91) });
});

router.get('/stats/leaderboard', async (ctx) => {
  ctx.ok({ items: users.leaderboard(10) });
});

/* ================= 搜索 ================= */

router.get('/search', async (ctx) => {
  const q = String(ctx.query.q || '').trim();
  if (!q) return ctx.ok({ q, total: 0, groups: [] });
  track('search', { userId: ctx.user?.id, meta: { q } });
  const like = `%${q}%`;
  const found = {
    posts: all(
      `SELECT p.id, p.title, p.slug, p.excerpt, p.views, p.published_at, u.nickname
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.status='published' AND (p.title LIKE ? OR p.content LIKE ?) ORDER BY p.views DESC LIMIT 8`,
      [like, like],
    ),
    notes: ctx.user
      ? all('SELECT id, title, substr(content,1,120) AS snippet, updated_at FROM notes WHERE user_id = ? AND (title LIKE ? OR content LIKE ?) LIMIT 6', [
          ctx.user.id,
          like,
          like,
        ])
      : [],
    links: ctx.user
      ? all('SELECT id, title, url, note FROM links WHERE user_id = ? AND (title LIKE ? OR url LIKE ? OR note LIKE ?) LIMIT 6', [
          ctx.user.id,
          like,
          like,
          like,
        ])
      : [],
    todos: ctx.user
      ? all('SELECT id, title, done, due_at FROM todos WHERE user_id = ? AND (title LIKE ? OR detail LIKE ?) LIMIT 6', [
          ctx.user.id,
          like,
          like,
        ])
      : [],
    users: all('SELECT id, username, nickname, bio, avatar_color FROM users WHERE username LIKE ? OR nickname LIKE ? LIMIT 5', [like, like]),
    tags: all('SELECT name, slug FROM tags WHERE name LIKE ? LIMIT 6', [like]),
  };
  const total = Object.values(found).reduce((s, arr) => s + arr.length, 0);
  ctx.ok({ q, total, groups: found });
});

/* ================= 用户 ================= */

router.get('/users', async (ctx) => {
  ctx.ok(
    users.list({
      page: v.int(ctx.query.page, '页码', { min: 1, fallback: 1 }),
      size: v.int(ctx.query.size, '每页', { min: 1, max: 50, fallback: 20 }),
      q: ctx.query.q || '',
      sort: ctx.query.sort || 'created_at',
    }),
  );
});

router.get('/users/:username', async (ctx) => {
  const user = all('SELECT id FROM users WHERE username = ?', [ctx.params.username])[0];
  if (!user) throw HttpError.notFound('用户不存在');
  const profile = users.findById(user.id);
  ctx.ok({
    user: profile,
    posts: posts.query({ authorId: user.id, status: 'published', size: 8 }).items,
    stats: {
      posts: get("SELECT COUNT(*) AS c FROM posts WHERE author_id=? AND status='published'", [user.id]).c,
      comments: get('SELECT COUNT(*) AS c FROM comments WHERE author_id=?', [user.id]).c,
      views: get("SELECT COALESCE(SUM(views),0) AS c FROM posts WHERE author_id=? AND status='published'", [user.id]).c,
      likes: get('SELECT COALESCE(SUM(likes),0) AS c FROM posts WHERE author_id=?', [user.id]).c,
    },
    isMe: ctx.user?.id === user.id,
  });
});

/* ================= 聊天室 REST ================= */

/** 房间列表（含未读数），游客 unread 恒为 0 */
router.get('/chat/rooms', async (ctx) => {
  ctx.ok({ items: chat.listRoomsWithUnread(chat.roomCounts(), ctx.user?.id || null) });
});

/** 房间详情 */
router.get('/chat/rooms/:slug', async (ctx) => {
  const room = chat.findRoom(ctx.params.slug);
  if (!room) throw HttpError.notFound('房间不存在');
  ctx.ok({ room });
});

/** 房间创建（登录） */
router.post('/chat/rooms', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const name = v.str(ctx.body.name, '房间名称', { min: 1, max: 24 });
  const topic = v.str(ctx.body.topic, '房间主题', { required: false, max: 80 }) || '';
  ctx.created({ room: chat.createRoom({ name, topic, createdBy: ctx.user.id }) });
});

/** 分页历史：before 传上一页最早一条的 createdAt */
router.get('/chat/history', async (ctx) => {
  const room = v.str(ctx.query.room, '房间', { max: 20, required: false }) || chat.SYSTEM_ROOM;
  if (!chat.roomExists(room)) throw HttpError.notFound('房间不存在');
  const limit = v.int(ctx.query.limit, '条数', { min: 1, max: 120, fallback: 50 });
  const before = v.str(ctx.query.before, '游标', { required: false, max: 40 }) || null;
  ctx.ok({
    room,
    ...messages.history(
      room,
      { id: ctx.user?.id || null, role: ctx.user?.role || null, actor: ctx.user ? chat.actorKey({ userId: ctx.user.id, nickname: '' }) : null },
      { limit, before },
    ),
  });
});

/**
 * 直接发消息（HTTP 兜底，便于脚本/机器人接入）。
 * 必须与 WebSocket 通道对齐：同样的昵称净化、禁言、限流，
 * 并且落库后要广播给房间内在线客户端，否则消息在前端凭空消失。
 */
router.post('/chat/messages', async (ctx) => {
  const room = v.str(ctx.body.room, '房间', { required: false, max: 20 }) || chat.SYSTEM_ROOM;
  if (!chat.roomExists(room)) throw HttpError.notFound('房间不存在');
  const body = v.str(ctx.body.body, '消息', { min: 1, max: 2000, trim: false });
  const guestId = v.str(ctx.body.guestId, '访客标识', { required: false, max: 40 }) || '';
  const rawNick =
    ctx.user?.nickname || ctx.user?.username || v.str(ctx.body.nickname, '昵称', { min: 1, max: 20 });
  const nickname = ctx.user ? rawNick : chat.sanitizeNickname(rawNick, '游客');
  const actor = chat.actorKey({ userId: ctx.user?.id || null, nickname, guestId });

  // 与 WS 共用同一个限流器，防止绕过浏览器端 8 次/5 秒
  const gate = chatGateway.takeRateLimit(actor);
  if (!gate.ok) {
    const secs = Math.ceil(gate.retryAfterMs / 1000);
    ctx.setHeader('Retry-After', String(secs));
    throw HttpError.tooMany(`发言过于频繁，请 ${secs} 秒后再试`);
  }
  chat.assertNotMuted(actor);

  const row = messages.add({
    room,
    nickname,
    body,
    userId: ctx.user?.id || null,
    replyTo: v.str(ctx.body.replyTo, '引用', { required: false, max: 40 }) || null,
    actor,
  });
  if (ctx.user) {
    points.earn(ctx.user.id, 'chat_message');
    chat.markRead(ctx.user.id, room, row.created_at);
  }
  chatGateway.pushMessage(row, room);
  ctx.created({ message: messages.shapeMessage(row, { id: ctx.user?.id || null, role: ctx.user?.role || null, actor }) });
});

/** 未读数 */
router.get('/chat/unread', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const items = chat.listRoomsWithUnread(chat.roomCounts(), ctx.user.id);
  ctx.ok({ items: items.map((r) => ({ room: r.slug, unread: r.unread })), total: items.reduce((n, r) => n + r.unread, 0) });
});

/** 标记已读 */
router.post('/chat/read', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const room = v.str(ctx.body.room, '房间', { max: 20, required: false }) || chat.SYSTEM_ROOM;
  if (!chat.roomExists(room)) throw HttpError.notFound('房间不存在');
  chat.markRead(ctx.user.id, room);
  ctx.ok({ room, unread: 0 });
});

/** 消息内搜索（仅管理员） */
router.get('/admin/chat/messages', async (ctx) => {
  requireAdmin(ctx);
  const q = v.str(ctx.query.q, '关键词', { required: false, max: 40 }) || '';
  const room = v.str(ctx.query.room, '房间', { required: false, max: 20 }) || null;
  const kind = v.str(ctx.query.kind, '类型', { required: false, max: 10 }) || null;
  const limit = v.int(ctx.query.limit, '条数', { min: 1, max: 120, fallback: 50 });
  ctx.ok({ items: messages.search({ q, room, kind, limit }) });
});

/** 聊天室管理总览（仅管理员） */
router.get('/admin/chat', async (ctx) => {
  requireAdmin(ctx);
  ctx.ok({
    rooms: chat.listRooms(chat.roomCounts(), null),
    mutes: chat.listMutes(),
    ...chat.stats(),
  });
});

/** 新建房间（仅管理员） */
router.post('/admin/chat/rooms', async (ctx) => {
  requireAdmin(ctx);
  const name = v.str(ctx.body.name, '房间名称', { min: 1, max: 24 });
  const topic = v.str(ctx.body.topic, '房间主题', { required: false, max: 80 }) || '';
  ctx.created({ room: chat.createRoom({ name, topic, createdBy: ctx.user.id }) });
});

/** 编辑房间（仅管理员，系统房间除外） */
router.patch('/admin/chat/rooms/:slug', async (ctx) => {
  requireAdmin(ctx);
  try {
    const room = chat.updateRoom(ctx.params.slug, {
      name: ctx.body.name,
      topic: ctx.body.topic,
      sort: ctx.body.sort,
      kind: ctx.body.kind,
    });
    if (!room) throw HttpError.notFound('房间不存在');
    ctx.ok({ room });
  } catch (err) {
    throw HttpError.badRequest(err.message);
  }
});

/** 删除房间（仅管理员，系统房间除外） */
router.delete('/admin/chat/rooms/:slug', async (ctx) => {
  requireAdmin(ctx);
  if (!chat.deleteRoom(ctx.params.slug)) throw HttpError.badRequest('房间不存在或系统房间不可删除');
  ctx.ok({ ok: true });
});

/** 禁言（仅管理员）：target 可为 userId / guestId / 昵称 */
router.post('/admin/chat/mute', async (ctx) => {
  requireAdmin(ctx);
  const label = v.str(ctx.body.target, '禁言目标', { min: 1, max: 40 });
  let actor;
  try {
    actor = chatGateway.resolveMuteTarget(label);
  } catch {
    throw HttpError.badRequest('目标昵称无效');
  }
  const minutes = v.int(ctx.body.minutes, '分钟', { min: 0, max: 10080, fallback: 10 });
  const reason = v.str(ctx.body.reason, '原因', { required: false, max: 80 }) || '管理员禁言';
  const mute = chat.mute({ target: actor, minutes, reason, createdBy: ctx.user.id });
  chatGateway.pushMutes();
  ctx.created({ mute, target: label, actor });
});

/** 解除禁言（仅管理员） */
router.delete('/admin/chat/mute', async (ctx) => {
  requireAdmin(ctx);
  const label = v.str(ctx.query.target, '禁言目标', { min: 1, max: 40 });
  let actor;
  try {
    actor = chatGateway.resolveMuteTarget(label);
  } catch {
    throw HttpError.badRequest('目标昵称无效');
  }
  const ok = chat.unmute(actor);
  chatGateway.pushMutes();
  ctx.ok({ ok, target: label, actor });
});

/* ================= 管理后台 ================= */

function requireAdmin(ctx) {
  if (!ctx.user) throw HttpError.unauthorized();
  if (ctx.user.role !== 'admin') throw HttpError.forbidden('仅管理员可访问');
}

router.get('/admin/overview', async (ctx) => {
  requireAdmin(ctx);
  ctx.ok({
    stats: stats.overview(),
    types: stats.typeBreakdown(),
    pendingComments: comments.pendingCount(),
    users: all('SELECT id, username, email, role, created_at, last_login, post_count FROM users ORDER BY created_at DESC LIMIT 50'),
    subscribers: all('SELECT id, email, status, source, created_at FROM subscribers ORDER BY created_at DESC LIMIT 50'),
    shorts: all('SELECT id, code, target, clicks, active, created_at FROM short_links ORDER BY clicks DESC LIMIT 50'),
    settings: {
      site_name: getSetting('site_name', 'Hub'),
      site_tagline: getSetting('site_tagline', ''),
      site_description: getSetting('site_description', ''),
      icp: getSetting('icp', ''),
      footer_text: getSetting('footer_text', ''),
      allow_registration: getSetting('allow_registration', true),
    },
  });
});

router.get('/admin/comments', async (ctx) => {
  requireAdmin(ctx);
  const status = ctx.query.status || 'pending';
  ctx.ok({
    items: all(
      `SELECT c.id, c.body, c.status, c.created_at, c.guest_name, p.title AS post_title, p.slug AS post_slug, p.id AS post_id,
              u.username, u.nickname, u.avatar_color
       FROM comments c JOIN posts p ON p.id = c.post_id LEFT JOIN users u ON u.id = c.author_id
       WHERE c.status = ? ORDER BY c.created_at DESC LIMIT 100`,
      [status],
    ).map((c) => ({
      id: c.id,
      body: c.body,
      status: c.status,
      createdAt: c.created_at,
      guestName: c.guest_name,
      username: c.username,
      nickname: c.nickname,
      avatarColor: c.avatar_color,
      postId: c.post_id,
      postTitle: c.post_title,
      postSlug: c.post_slug,
    })),
  });
});

router.patch('/admin/comments/:id', async (ctx) => {
  requireAdmin(ctx);
  const status = v.oneOf(ctx.body.status, '状态', ['pending', 'published', 'spam']);
  comments.setStatus(ctx.params.id, status);
  ctx.ok({ ok: true, status });
});

router.get('/admin/events', async (ctx) => {
  requireAdmin(ctx);
  ctx.ok({
    items: all('SELECT type, COUNT(*) AS c FROM events GROUP BY type ORDER BY c DESC'),
    recent: all('SELECT type, target, meta, created_at FROM events ORDER BY created_at DESC LIMIT 40'),
  });
});

router.post('/admin/users/:id/role', async (ctx) => {
  requireAdmin(ctx);
  const role = v.oneOf(ctx.body.role, '角色', ['user', 'admin', 'moderator']);
  if (ctx.params.id === ctx.user.id && role !== 'admin') throw HttpError.badRequest('不能撤销自己的管理员权限');
  ctx.ok({ user: users.setRole(ctx.params.id, role) });
});

router.delete('/admin/users/:id', async (ctx) => {
  requireAdmin(ctx);
  if (ctx.params.id === ctx.user.id) throw HttpError.badRequest('不能删除自己');
  users.remove(ctx.params.id);
  ctx.ok({ ok: true });
});

router.post('/admin/settings', async (ctx) => {
  requireAdmin(ctx);
  const keys = ['site_name', 'site_tagline', 'site_description', 'icp', 'footer_text', 'allow_registration'];
  for (const key of keys) {
    if (ctx.body[key] !== undefined) setSetting(key, ctx.body[key]);
  }
  ctx.ok({ ok: true, updatedAt: nowIso() });
});

router.post('/admin/chat/clear', async (ctx) => {
  requireAdmin(ctx);
  const room = v.str(ctx.body.room, '房间', { required: false, max: 20 }) || chat.SYSTEM_ROOM;
  if (!chat.roomExists(room)) throw HttpError.notFound('房间不存在');
  messages.clearRoom(room);
  chatGateway.pushCleared(room);
  ctx.ok({ ok: true, room });
});

router.post('/admin/posts/:id/feature', async (ctx) => {
  requireAdmin(ctx);
  const post = posts.findById(ctx.params.id);
  if (!post) throw HttpError.notFound('文章不存在');
  ctx.ok({ post: posts.update(ctx.params.id, { featured: !post.featured }, {}) });
});

router.get('/admin/database', async (ctx) => {
  requireAdmin(ctx);
  const tables = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  ctx.ok({
    tables: tables.map((t) => ({
      name: t.name,
      rows: get(`SELECT COUNT(*) AS c FROM "${t.name}"`).c,
    })),
  });
});

router.post('/admin/maintenance/vacuum', async (ctx) => {
  requireAdmin(ctx);
  const { db } = await import('../db.js');
  const before = process.memoryUsage().heapUsed;
  db.exec('VACUUM');
  run("DELETE FROM events WHERE created_at < datetime('now', '-90 days')");
  ctx.ok({ ok: true, reclaimed: before - process.memoryUsage().heapUsed });
});

export default router;
