import { all, get } from '../db.js';
import * as notes from '../models/notes.js';
import * as todos from '../models/todos.js';
import * as links from '../models/links.js';
import * as files from '../models/files.js';
import * as users from '../models/users.js';
import { dailyTrend, activityHeatmap, streak, recentEvents, getSettings, updateSettings } from '../models/stats.js';
import { globalSearch } from '../models/search.js';
import { forbidden, notFound, badRequest, conflict } from '../lib/http-error.js';
import { bool, str, oneOf, logEvent } from '../lib/validate.js';

/** 仪表盘聚合数据：一次请求返回首屏所需的全部指标。 */
export function overview(userId) {
  const storage = files.storageStats(userId);
  return {
    notes: { total: notes.countNotes(userId) },
    todos: todos.todoStats(userId),
    links: links.linkStats(userId),
    files: { total: storage.count, used: storage.used },
    streak: streak(userId),
    trend: dailyTrend(userId, 14),
    recentNotes: notes.recentNotes(userId, 5),
    upcoming: todos.upcomingTodos(userId, 5),
    topLinks: links.topLinks(userId, 5),
    activity: recentEvents(userId, 8),
  };
}

export function registerDashboard(router) {
  router.get('/api/dashboard', async (ctx) => {
    ctx.json(200, overview(ctx.requireUser().id));
  });

  router.get('/api/dashboard/heatmap', async (ctx) => {
    ctx.json(200, { cells: activityHeatmap(ctx.requireUser().id) });
  });

  router.get('/api/search', async (ctx) => {
    const user = ctx.requireUser();
    ctx.json(200, globalSearch(user.id, ctx.query.q ?? '', { scope: ctx.query.scope ?? 'all' }));
  });
}

export function registerPublic(router) {
  router.get('/api/site', async (ctx) => {
    const settings = getSettings();
    ctx.json(200, {
      settings,
      stats: {
        users: users.countUsers(),
        notes: get('SELECT COUNT(*) AS n FROM notes').n,
      },
    });
  });

  router.get('/api/users', async (ctx) => {
    ctx.json(200, { items: users.listUsers(30) });
  });

  router.get('/api/users/:username', async (ctx) => {
    const user = users.findProfile(ctx.params.username);
    if (!user) throw notFound('用户不存在');
    ctx.json(200, {
      user: users.toPublic(user),
      stats: {
        notes: notes.countNotes(user.id),
        links: links.linkStats(user.id).total,
      },
      recentNotes: notes.recentNotes(user.id, 5),
    });
  });
}

export function registerAdmin(router) {
  const requireAdmin = (ctx) => {
    const user = ctx.requireUser();
    if (user.role !== 'admin') throw forbidden('需要管理员权限');
    return user;
  };

  router.get('/api/admin/overview', async (ctx) => {
    requireAdmin(ctx);
    ctx.json(200, {
      users: users.countUsers(),
      notes: get('SELECT COUNT(*) AS n FROM notes').n,
      todos: get('SELECT COUNT(*) AS n FROM todos').n,
      links: get('SELECT COUNT(*) AS n FROM links').n,
      files: get('SELECT COUNT(*) AS n FROM files').n,
      storage: get('SELECT COALESCE(SUM(size), 0) AS n FROM files').n,
      recentUsers: all('SELECT id, username, nickname, role, created_at AS createdAt FROM users ORDER BY id DESC LIMIT 8'),
    });
  });

  router.get('/api/admin/users', async (ctx) => {
    requireAdmin(ctx);
    ctx.json(200, { items: users.listUsers(100) });
  });

  router.post('/api/admin/users/:id/role', async (ctx) => {
    const admin = requireAdmin(ctx);
    const body = await ctx.input();
    const role = oneOf(body.role, '角色', ['user', 'admin']);
    const target = users.findById(Number(ctx.params.id));
    if (!target) throw notFound('用户不存在');
    if (target.id === admin.id) throw badRequest('不能修改自己的角色');
    users.setRole(target.id, role);
    logEvent(admin.id, 'admin.role', `${target.username} → ${role}`);
    ctx.json(200, { user: users.toPublic(users.findById(target.id)) });
  });

  router.delete('/api/admin/users/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    const target = users.findById(Number(ctx.params.id));
    if (!target) throw notFound('用户不存在');
    if (target.id === admin.id) throw badRequest('不能删除自己的账号');
    if (target.role === 'admin' && users.listUsers(500).filter((user) => user.role === 'admin').length <= 1) {
      throw conflict('至少需要保留一名管理员');
    }
    users.removeUser(target.id);
    logEvent(admin.id, 'admin.delete-user', target.username);
    ctx.json(200, { ok: true });
  });

  router.get('/api/admin/settings', async (ctx) => {
    requireAdmin(ctx);
    ctx.json(200, { settings: getSettings() });
  });

  router.patch('/api/admin/settings', async (ctx) => {
    const admin = requireAdmin(ctx);
    const body = await ctx.input();
    const patch = {};
    if (body.site_name !== undefined) patch.site_name = str(body.site_name, '站点名称', { max: 40 });
    if (body.site_tagline !== undefined) patch.site_tagline = str(body.site_tagline, '站点标语', { max: 80, required: false, fallback: '' });
    if (body.allow_registration !== undefined) patch.allow_registration = String(bool(body.allow_registration));
    updateSettings(patch);
    logEvent(admin.id, 'admin.settings', '更新站点设置');
    ctx.json(200, { settings: getSettings() });
  });
}
