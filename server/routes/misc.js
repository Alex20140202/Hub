import { Router, readBody } from '../http/router.js';
import * as shorts from '../models/shorts.js';
import * as files from '../models/files.js';
import * as v from '../lib/validate.js';
import HttpError from '../lib/http-error.js';
import { track } from '../models/seed.js';
import { earn } from '../models/points.js';
import { get, run, all } from '../db.js';
import { randomId, nowIso } from '../lib/id.js';
import config from '../config.js';

const router = new Router();

router.use(async (ctx) => {
  const parsed = await readBody(ctx.req);
  ctx.body = parsed.body;
  ctx.files = parsed.files;
});

/* ================= 短链 ================= */

router.post('/shorts', async (ctx) => {
  const link = shorts.create({
    target: v.url(ctx.body.target, '目标链接'),
    title: v.str(ctx.body.title, '标题', { required: false, max: 120 }),
    userId: ctx.user?.id || null,
    custom: ctx.body.code ? v.str(ctx.body.code, '自定义短码', { max: 32 }) : null,
    expiresAt: ctx.body.expiresAt || null,
  });
  track('create_short', { userId: ctx.user?.id, target: link.code });
  ctx.created({ link });
});

router.get('/shorts', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  ctx.ok({ items: shorts.list(ctx.user.id), top: shorts.topClocks() });
});

router.patch('/shorts/:id', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  ctx.ok({
    link: shorts.update(ctx.params.id, ctx.user.id, {
      title: ctx.body.title,
      active: ctx.body.active,
      expiresAt: ctx.body.expiresAt,
    }, ctx.user.role === 'admin'),
  });
});

router.delete('/shorts/:id', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  shorts.remove(ctx.params.id, ctx.user.id, ctx.user.role === 'admin');
  ctx.ok({ ok: true });
});

/* ================= 文件 ================= */

router.get('/files', async (ctx) => {
  ctx.ok({
    ...files.list(ctx.user?.id || null, {
      folder: ctx.query.folder || null,
      q: ctx.query.q || '',
      page: v.int(ctx.query.page, '页码', { min: 1, fallback: 1 }),
      size: v.int(ctx.query.size, '每页', { min: 1, max: 100, fallback: 24 }),
    }),
    usage: files.usage(),
    folders: files.FOLDERS,
  });
});

router.post('/files', async (ctx) => {
  const file = ctx.files?.file || Object.values(ctx.files || {})[0];
  if (!file) throw HttpError.badRequest('请选择要上传的文件（字段名 file）');
  if (!ctx.user) throw HttpError.unauthorized();
  const record = await files.store({
    file,
    userId: ctx.user.id,
    folder: ctx.body.folder ? v.oneOf(ctx.body.folder, '目录', files.FOLDERS) : null,
    description: v.str(ctx.body.description, '描述', { required: false, max: 300 }),
    isPublic: v.bool(ctx.body.isPublic, true),
  });
  track('upload_file', { userId: ctx.user.id, meta: { size: record.size, mime: record.mime } });
  const reward = earn(ctx.user.id, 'upload_file');
  ctx.created({ file: record, reward });
});

router.patch('/files/:id', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const record = files.find(ctx.params.id);
  if (record.userId !== ctx.user.id && ctx.user.role !== 'admin') throw HttpError.forbidden('无权修改该文件信息');
  ctx.ok({
    file: files.update(ctx.params.id, {
      description: ctx.body.description,
      folder: ctx.body.folder,
      isPublic: ctx.body.isPublic,
    }),
  });
});

router.delete('/files/:id', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const row = get('SELECT user_id FROM files WHERE id = ?', [ctx.params.id]);
  if (!row) throw HttpError.notFound('文件不存在');
  if (row.user_id !== ctx.user.id && ctx.user.role !== 'admin') throw HttpError.forbidden('无权删除该文件');
  await files.remove(ctx.params.id);
  ctx.ok({ ok: true });
});

/* ================= 订阅 ================= */

router.post('/subscribe', async (ctx) => {
  const email = v.email(ctx.body.email);
  const existing = get('SELECT id, status FROM subscribers WHERE email = ?', [email]);
  if (existing) {
    run('UPDATE subscribers SET status = ? WHERE id = ?', ['pending', existing.id]);
    ctx.ok({ ok: true, message: '订阅确认邮件已重新发送（演示环境直接生效）' });
    return;
  }
  run('INSERT INTO subscribers (id, email, status, source, created_at) VALUES (?,?,?,?,?)', [
    randomId(10),
    email,
    'pending',
    v.str(ctx.body.source, '来源', { required: false, max: 40 }) || 'site',
    nowIso(),
  ]);
  track('subscribe', { meta: { email } });
  ctx.created({ ok: true, message: '订阅成功！' });
});

/* ================= 账号导出 ================= */

router.get('/export', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const data = {
    exportedAt: nowIso(),
    user: all('SELECT username, email, nickname, bio, created_at FROM users WHERE id = ?', [ctx.user.id])[0],
    notes: all('SELECT title, content, tags, pinned, created_at, updated_at FROM notes WHERE user_id = ?', [ctx.user.id]),
    todos: all('SELECT title, detail, priority, done, due_at, project, created_at FROM todos WHERE user_id = ?', [ctx.user.id]),
    links: all('SELECT title, url, note, tags, category, created_at FROM links WHERE user_id = ?', [ctx.user.id]),
    shorts: all('SELECT code, target, title, clicks, created_at FROM short_links WHERE user_id = ?', [ctx.user.id]),
    bookmarks: all('SELECT p.title, p.slug FROM bookmarks b JOIN posts p ON p.id = b.post_id WHERE b.user_id = ?', [ctx.user.id]),
  };
  ctx.setHeader('Content-Disposition', `attachment; filename="hub-export-${Date.now()}.json"`);
  ctx.json(200, data);
});

router.get('/health', async (ctx) => {
  ctx.ok({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    version: '1.0.0',
    node: process.version,
    memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
    env: config.env,
  });
});

export default router;
