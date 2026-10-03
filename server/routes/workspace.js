import { notFound, tooLarge, badRequest } from '../lib/http-error.js';
import { str, tags as vTags, oneOf, bool, dateOrNull, int, url as vUrl, folder as vFolder, NOTE_COLORS, PRIORITIES, logEvent } from '../lib/validate.js';
import * as notes from '../models/notes.js';
import * as todos from '../models/todos.js';
import * as links from '../models/links.js';
import * as files from '../models/files.js';
import { config } from '../config.js';
import { randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const limit = (value, fallback, max) => int(value, '数量', { min: 1, max, fallback });

/* ---------------------------------- 笔记 ---------------------------------- */

export function registerNotes(router) {
  router.get('/api/notes', async (ctx) => {
    const user = ctx.requireUser();
    const { items, total } = notes.listNotes(user.id, {
      q: ctx.query.q ?? '',
      tag: ctx.query.tag ?? '',
      limit: limit(ctx.query.limit, 100, 200),
      offset: int(ctx.query.offset, '偏移', { min: 0, fallback: 0 }),
    });
    ctx.json(200, { items, total });
  });

  router.get('/api/notes/tags', async (ctx) => ctx.json(200, { items: notes.noteTags(ctx.requireUser().id) }));

  router.get('/api/notes/:id', async (ctx) => {
    const user = ctx.requireUser();
    const note = notes.getNote(Number(ctx.params.id), user.id);
    if (!note) throw notFound('笔记不存在');
    ctx.json(200, { note });
  });

  router.post('/api/notes', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    const note = notes.createNote(user.id, {
      title: str(body.title, '标题', { max: 120, required: false, fallback: '' }),
      body: str(body.body, '正文', { max: 20000, required: false, fallback: '' }),
      tags: vTags(body.tags ?? ''),
      color: oneOf(body.color, '颜色', NOTE_COLORS, 'slate'),
      pinned: bool(body.pinned),
    });
    logEvent(user.id, 'note.create', note.title || '无标题笔记');
    ctx.json(201, { note });
  });

  router.patch('/api/notes/:id', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    const id = Number(ctx.params.id);
    const patch = {};
    if (body.title !== undefined) patch.title = str(body.title, '标题', { max: 120, required: false, fallback: '' });
    if (body.body !== undefined) patch.body = str(body.body, '正文', { max: 20000, required: false, fallback: '' });
    if (body.tags !== undefined) patch.tags = vTags(body.tags);
    if (body.color !== undefined) patch.color = oneOf(body.color, '颜色', NOTE_COLORS);
    if (body.pinned !== undefined) patch.pinned = bool(body.pinned);

    const note = notes.updateNote(id, user.id, patch);
    if (!note) throw notFound('笔记不存在');
    if (body.pinned !== undefined) logEvent(user.id, note.pinned ? 'note.pin' : 'note.unpin', note.title || '无标题笔记');
    ctx.json(200, { note });
  });

  router.delete('/api/notes/:id', async (ctx) => {
    const user = ctx.requireUser();
    const ok = notes.deleteNote(Number(ctx.params.id), user.id);
    if (!ok) throw notFound('笔记不存在');
    logEvent(user.id, 'note.delete', '删除笔记');
    ctx.json(200, { ok: true });
  });
}

/* ---------------------------------- 待办 ---------------------------------- */

export function registerTodos(router) {
  router.get('/api/todos', async (ctx) => {
    const user = ctx.requireUser();
    const items = todos.listTodos(user.id, { q: ctx.query.q ?? '', filter: ctx.query.filter ?? 'all' });
    ctx.json(200, { items, stats: todos.todoStats(user.id) });
  });

  router.post('/api/todos', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    const todo = todos.createTodo(user.id, {
      title: str(body.title, '待办标题', { max: 160 }),
      detail: str(body.detail, '备注', { max: 2000, required: false, fallback: '' }),
      priority: oneOf(body.priority, '优先级', PRIORITIES, 'normal'),
      dueAt: dateOrNull(body.dueAt, '截止时间'),
    });
    logEvent(user.id, 'todo.create', todo.title);
    ctx.json(201, { todo });
  });

  router.patch('/api/todos/:id', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    const patch = {};
    if (body.title !== undefined) patch.title = str(body.title, '待办标题', { max: 160 });
    if (body.detail !== undefined) patch.detail = str(body.detail, '备注', { max: 2000, required: false, fallback: '' });
    if (body.priority !== undefined) patch.priority = oneOf(body.priority, '优先级', PRIORITIES);
    if (body.done !== undefined) patch.done = bool(body.done);
    if (body.dueAt !== undefined) patch.dueAt = dateOrNull(body.dueAt, '截止时间');

    const todo = todos.updateTodo(Number(ctx.params.id), user.id, patch);
    if (!todo) throw notFound('待办不存在');
    if (patch.done === true) logEvent(user.id, 'todo.complete', todo.title);
    ctx.json(200, { todo, stats: todos.todoStats(user.id) });
  });

  router.post('/api/todos/reorder', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    const order = Array.isArray(body.order) ? body.order : [];
    if (!order.length) throw badRequest('order 不能为空');
    const moved = todos.reorder(user.id, order.map(Number));
    ctx.json(200, { ok: true, moved });
  });

  router.post('/api/todos/clear-completed', async (ctx) => {
    const user = ctx.requireUser();
    const removed = todos.clearCompleted(user.id);
    if (removed) logEvent(user.id, 'todo.clear', `清理 ${removed} 项`);
    ctx.json(200, { ok: true, removed, stats: todos.todoStats(user.id) });
  });

  router.delete('/api/todos/:id', async (ctx) => {
    const user = ctx.requireUser();
    if (!todos.deleteTodo(Number(ctx.params.id), user.id)) throw notFound('待办不存在');
    logEvent(user.id, 'todo.delete', '删除待办');
    ctx.json(200, { ok: true });
  });
}

/* ---------------------------------- 书签 ---------------------------------- */

export function registerLinks(router) {
  router.get('/api/links', async (ctx) => {
    const user = ctx.requireUser();
    const items = links.listLinks(user.id, {
      q: ctx.query.q ?? '',
      tag: ctx.query.tag ?? '',
      starred: ctx.query.starred === 'true' || ctx.query.starred === '1',
      sort: ctx.query.sort ?? 'recent',
    });
    ctx.json(200, { items, stats: links.linkStats(user.id) });
  });

  router.get('/api/links/tags', async (ctx) => ctx.json(200, { items: links.allTags(ctx.requireUser().id) }));

  router.post('/api/links', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    const target = vUrl(body.url);
    const link = links.createLink(user.id, {
      title: str(body.title, '标题', { max: 160, required: false, fallback: '' }) || new URL(target).hostname,
      url: target,
      description: str(body.description, '描述', { max: 300, required: false, fallback: '' }),
      tags: vTags(body.tags ?? ''),
      starred: bool(body.starred),
    });
    logEvent(user.id, 'link.create', link.title);
    ctx.json(201, { link });
  });

  router.patch('/api/links/:id', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    const patch = {};
    if (body.title !== undefined) patch.title = str(body.title, '标题', { max: 160, required: false });
    if (body.url !== undefined) patch.url = vUrl(body.url);
    if (body.description !== undefined) patch.description = str(body.description, '描述', { max: 300, required: false, fallback: '' });
    if (body.tags !== undefined) patch.tags = vTags(body.tags);
    if (body.starred !== undefined) patch.starred = bool(body.starred);

    const link = links.updateLink(Number(ctx.params.id), user.id, patch);
    if (!link) throw notFound('书签不存在');
    ctx.json(200, { link });
  });

  router.post('/api/links/:id/click', async (ctx) => {
    const user = ctx.requireUser();
    const link = links.registerClick(Number(ctx.params.id), user.id);
    if (!link) throw notFound('书签不存在');
    ctx.json(200, { link });
  });

  router.delete('/api/links/:id', async (ctx) => {
    const user = ctx.requireUser();
    if (!links.deleteLink(Number(ctx.params.id), user.id)) throw notFound('书签不存在');
    logEvent(user.id, 'link.delete', '删除书签');
    ctx.json(200, { ok: true });
  });
}

/* ---------------------------------- 文件 ---------------------------------- */

const humanSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
};

export function registerFiles(router) {
  router.get('/api/files', async (ctx) => {
    const user = ctx.requireUser();
    const storage = files.storageStats(user.id);
    ctx.json(200, {
      items: files.listFiles(user.id, { q: ctx.query.q ?? '', folder: ctx.query.folder ?? '' }),
      storage: { ...storage, usedLabel: humanSize(storage.used) },
    });
  });

  router.post('/api/files', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    if (body?.fields === undefined) throw badRequest('请以 multipart/form-data 上传文件');
    const upload = (body.files ?? [])[0];
    if (!upload?.data?.length) throw badRequest('请选择要上传的文件');
    if (upload.data.length > config.maxUploadBytes) {
      throw tooLarge(`单个文件不能超过 ${humanSize(config.maxUploadBytes)}`);
    }
    // 存储配额：基数 + 商城扩容，已用满直接拒绝
    const storage = files.storageStats(user.id);
    if (storage.used + upload.data.length > storage.quota) {
      throw tooLarge(`存储空间不足（已用 ${humanSize(storage.used)} / ${humanSize(storage.quota)}），可到积分商城扩容`);
    }

    const storedName = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}${path.extname(upload.filename).slice(0, 12)}`;
    await mkdir(config.uploadDir, { recursive: true });
    await writeFile(files.resolveStoredPath(storedName), upload.data);

    const file = files.createFile(user.id, {
      name: str(body.fields.name, '文件名', { max: 160, required: false }) || upload.filename,
      storedName,
      mime: upload.type,
      size: upload.data.length,
      folder: vFolder(body.fields.folder),
      isPublic: bool(body.fields.isPublic),
    });
    logEvent(user.id, 'file.upload', file.name);
    ctx.json(201, { file });
  });

  router.patch('/api/files/:id', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    const patch = {};
    if (body.name !== undefined) patch.name = str(body.name, '文件名', { max: 160 });
    if (body.folder !== undefined) patch.folder = vFolder(body.folder);
    if (body.isPublic !== undefined) patch.isPublic = bool(body.isPublic);

    const file = files.updateFile(Number(ctx.params.id), user.id, patch);
    if (!file) throw notFound('文件不存在');
    ctx.json(200, { file });
  });

  router.get('/api/files/:id/download', async (ctx) => {
    const user = ctx.requireUser();
    const file = files.getFile(Number(ctx.params.id), user.id);
    if (!file) throw notFound('文件不存在');
    files.registerDownload(file.id);
    logEvent(user.id, 'file.download', file.name);
    const target = files.resolveStoredPath(file.storedName);
    ctx.download(target, file.name, file.mime);
  });

  router.delete('/api/files/:id', async (ctx) => {
    const user = ctx.requireUser();
    if (!(await files.deleteFile(Number(ctx.params.id), user.id))) throw notFound('文件不存在');
    logEvent(user.id, 'file.delete', '删除文件');
    ctx.json(200, { ok: true });
  });
}
