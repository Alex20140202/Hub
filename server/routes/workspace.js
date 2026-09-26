import { Router, readBody } from '../http/router.js';
import * as notes from '../models/notes.js';
import * as todos from '../models/todos.js';
import * as links from '../models/links.js';
import * as v from '../lib/validate.js';
import HttpError from '../lib/http-error.js';
import { track } from '../models/seed.js';
import { earn } from '../models/points.js';

const router = new Router();

router.use(async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const parsed = await readBody(ctx.req);
  ctx.body = parsed.body;
  ctx.files = parsed.files;
});

/* ================= 笔记 ================= */

router.get('/notes', async (ctx) => {
  ctx.ok({
    items: notes.list(ctx.user.id, {
      q: ctx.query.q || '',
      archived: ctx.query.archived === 'true',
      color: ctx.query.color || null,
    }),
  });
});

router.post('/notes', async (ctx) => {
  const note = notes.create(ctx.user.id, {
    title: v.str(ctx.body.title, '标题', { max: 120 }),
    content: v.str(ctx.body.content, '内容', { required: false, max: 100_000, trim: false }),
    color: v.oneOf(ctx.body.color, '颜色', ['default', 'blue', 'green', 'orange', 'red', 'purple'], 'default'),
    pinned: v.bool(ctx.body.pinned),
    tags: v.list(ctx.body.tags, '标签', { max: 10, maxItem: 20 }),
  });
  track('create_note', { userId: ctx.user.id });
  const reward = earn(ctx.user.id, 'create_note');
  ctx.created({ note, reward });
});

router.get('/notes/:id', async (ctx) => ctx.ok({ note: notes.find(ctx.params.id, ctx.user.id) }));

router.patch('/notes/:id', async (ctx) => {
  ctx.ok({
    note: notes.update(ctx.params.id, ctx.user.id, {
      title: ctx.body.title,
      content: ctx.body.content,
      color: ctx.body.color,
      pinned: ctx.body.pinned,
      archived: ctx.body.archived,
      tags: ctx.body.tags,
    }),
  });
});

router.delete('/notes/:id', async (ctx) => {
  notes.remove(ctx.params.id, ctx.user.id);
  ctx.ok({ ok: true });
});

/* ================= 待办 ================= */

router.get('/todos', async (ctx) => {
  ctx.ok({
    items: todos.list(ctx.user.id, {
      done: ctx.query.done === undefined ? null : ctx.query.done === 'true',
      project: ctx.query.project || null,
      q: ctx.query.q || '',
    }),
    projects: todos.projects(ctx.user.id),
    stats: todos.stats(ctx.user.id),
  });
});

router.post('/todos', async (ctx) => {
  const todo = todos.create(ctx.user.id, {
    title: v.str(ctx.body.title, '待办标题', { max: 200 }),
    detail: v.str(ctx.body.detail, '备注', { required: false, max: 2000, trim: false }),
    priority: v.int(ctx.body.priority, '优先级', { min: 1, max: 3, fallback: 2 }),
    dueAt: ctx.body.dueAt || null,
    project: v.str(ctx.body.project, '项目', { required: false, max: 40 }),
  });
  ctx.created({ todo });
});

router.patch('/todos/:id', async (ctx) => {
  ctx.ok({
    todo: todos.update(ctx.params.id, ctx.user.id, {
      title: ctx.body.title,
      detail: ctx.body.detail,
      priority: ctx.body.priority,
      done: ctx.body.done,
      dueAt: ctx.body.dueAt,
      project: ctx.body.project,
      position: ctx.body.position,
    }),
  });
});

router.post('/todos/:id/toggle', async (ctx) => {
  const current = todos.find(ctx.params.id, ctx.user.id);
  const done = !current.done;
  const reward = done ? earn(ctx.user.id, 'finish_todo', { detail: '完成待办' }) : null;
  ctx.ok({ todo: todos.update(ctx.params.id, ctx.user.id, { done }), reward });
});

router.delete('/todos/:id', async (ctx) => {
  todos.remove(ctx.params.id, ctx.user.id);
  ctx.ok({ ok: true });
});

router.post('/todos/clear-completed', async (ctx) => {
  ctx.ok({ removed: todos.clearCompleted(ctx.user.id) });
});

router.post('/todos/reorder', async (ctx) => {
  const ids = v.list(ctx.body.ids, '待办 ID', { max: 300, maxItem: 40 });
  todos.reorder(ctx.user.id, ids);
  ctx.ok({ ok: true });
});

/* ================= 书签 ================= */

router.get('/links', async (ctx) => {
  const result = links.list(ctx.user.id, {
    q: ctx.query.q || '',
    category: ctx.query.category || null,
    starred: ctx.query.starred === 'true',
    sort: ctx.query.sort || 'new',
  });
  ctx.ok({ ...result, categories: links.categoriesOf(ctx.user.id) });
});

router.post('/links', async (ctx) => {
  const link = links.create(ctx.user.id, {
    title: v.str(ctx.body.title, '标题', { max: 120 }),
    url: v.url(ctx.body.url, '链接'),
    note: v.str(ctx.body.note, '备注', { required: false, max: 500, trim: false }),
    tags: v.list(ctx.body.tags, '标签', { max: 10, maxItem: 20 }),
    category: v.str(ctx.body.category, '分类', { required: false, max: 30 }) || 'general',
    starred: v.bool(ctx.body.starred),
  });
  track('create_link', { userId: ctx.user.id });
  ctx.created({ link });
});

router.patch('/links/:id', async (ctx) => {
  ctx.ok({
    link: links.update(ctx.params.id, ctx.user.id, {
      title: ctx.body.title,
      url: ctx.body.url,
      note: ctx.body.note,
      tags: ctx.body.tags,
      category: ctx.body.category,
      starred: ctx.body.starred,
    }),
  });
});

router.delete('/links/:id', async (ctx) => {
  links.remove(ctx.params.id, ctx.user.id);
  ctx.ok({ ok: true });
});

router.post('/links/:id/click', async (ctx) => {
  links.find(ctx.params.id, ctx.user.id);
  ctx.ok({ clicks: links.trackClick(ctx.params.id) });
});

export default router;
