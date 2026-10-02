import * as pages from './pages.js';
import { renderLayout, renderGuestLayout } from './layout.js';
import { overview } from '../routes/dashboard.js';
import * as notes from '../models/notes.js';
import * as todos from '../models/todos.js';
import * as links from '../models/links.js';
import * as files from '../models/files.js';
import * as users from '../models/users.js';
import { getSettings } from '../models/stats.js';
import { notFound, forbidden } from '../lib/http-error.js';
import { config } from '../config.js';
import { all, get } from '../db.js';

/** 各路径对应的页面加载器：负责取数，渲染交给 views/pages.js。 */
const loaders = {
  '/': async (ctx) => ({ ...ctx, data: overview(ctx.user.id) }),

  '/notes': async (ctx) => {
    const query = ctx.query.q ?? '';
    const tag = ctx.query.tag ?? '';
    const { items, total } = notes.listNotes(ctx.user.id, { q: query, tag });
    return { ...ctx, data: { items, total, tags: notes.noteTags(ctx.user.id) } };
  },

  '/todos': async (ctx) => ({
    ...ctx,
    data: {
      items: todos.listTodos(ctx.user.id, { q: ctx.query.q ?? '', filter: ctx.query.filter ?? 'all' }),
      stats: todos.todoStats(ctx.user.id),
    },
  }),

  '/links': async (ctx) => {
    const items = links.listLinks(ctx.user.id, {
      q: ctx.query.q ?? '',
      tag: ctx.query.tag ?? '',
      starred: ctx.query.starred === '1',
      sort: ctx.query.sort ?? 'recent',
    });
    return { ...ctx, data: { items, stats: links.linkStats(ctx.user.id), tags: links.allTags(ctx.user.id) } };
  },

  '/files': async (ctx) => {
    const storage = files.storageStats(ctx.user.id);
    return {
      ...ctx,
      data: {
        items: files.listFiles(ctx.user.id, { q: ctx.query.q ?? '', folder: ctx.query.folder ?? '' }),
        storage: { ...storage, quota: config.maxUploadBytes * 200 },
      },
    };
  },

  '/search': async (ctx) => ({ ...ctx, data: {} }),
  '/settings': async (ctx) => ({
    ...ctx,
    data: { user: ctx.user, sessions: users.listSessions(ctx.user.id), site: getSettings() },
  }),
  '/admin': async (ctx) => {
    if (ctx.user.role !== 'admin') throw forbidden('需要管理员权限');
    return {
      ...ctx,
      data: {
        overview: {
          users: users.countUsers(),
          notes: get('SELECT COUNT(*) AS n FROM notes').n,
          todos: get('SELECT COUNT(*) AS n FROM todos').n,
          links: get('SELECT COUNT(*) AS n FROM links').n,
          files: get('SELECT COUNT(*) AS n FROM files').n,
          storage: get('SELECT COALESCE(SUM(size), 0) AS n FROM files').n,
        },
        users: users.listUsers(100),
        site: getSettings(),
      },
    };
  },
};

const renderers = {
  '/': (ctx) => [pages.dashboard(ctx), `${ctx.user.nickname}，欢迎回来`],
  '/notes': (ctx) => [pages.notesPage(ctx), '笔记'],
  '/todos': (ctx) => [pages.todosPage(ctx), '待办'],
  '/links': (ctx) => [pages.linksPage(ctx), '书签'],
  '/files': (ctx) => [pages.filesPage(ctx), '文件'],
  '/search': (ctx) => [pages.searchPage(ctx), '搜索'],
  '/settings': (ctx) => [pages.settingsPage(ctx), '设置'],
  '/admin': (ctx) => [pages.adminPage(ctx), '管理后台'],
};

const GUEST_PAGES = {
  '/': () => [pages.landingPage({ site: getSettings() }), getSettings().site_name],
  '/login': () => [pages.authPage({ mode: 'login', site: getSettings() }), '登录'],
  '/register': () => [pages.authPage({ mode: 'register', site: getSettings() }), '注册'],
};

/** 笔记详情等动态子路由。 */
const detailLoaders = {
  '/notes/:id': async (ctx) => {
    const note = notes.getNote(Number(ctx.params.id), ctx.user.id);
    if (!note) throw notFound('笔记不存在');
    return { ...ctx, data: { note } };
  },
  '/u/:username': async (ctx) => {
    const profile = users.findProfile(ctx.params.username);
    if (!profile) throw notFound('用户不存在');
    return {
      ...ctx,
      data: {
        profile,
        stats: { notes: notes.countNotes(profile.id), links: links.linkStats(profile.id).total },
        notes: notes.recentNotes(profile.id, 5),
      },
    };
  },
};

const detailRenderers = {
  '/notes/:id': (ctx) => [pages.noteDetail(ctx), ctx.data.note.title || '笔记'],
  '/u/:username': (ctx) => [pages.userPage(ctx), ctx.data.profile.nickname],
};

/**
 * 渲染完整页面 HTML。
 * 关键点：服务端是页面标记的唯一来源，客户端只请求 `?_partial=1` 拿片段替换。
 */
export async function renderPage({ pathname, user, query, params, sessionId, assets, partial }) {
  const site = getSettings();
  const detail = matchDetail(pathname);
  const ctx = { pathname, query, params: { ...params, ...detail?.params }, user, sessionId };
  let status = 200;
  let html;
  let title;

  if (user) {
    if (detail) {
      Object.assign(ctx, await detailLoaders[detail.pattern](ctx));
      [html, title] = detailRenderers[detail.pattern](ctx);
    } else if (loaders[pathname]) {
      Object.assign(ctx, await loaders[pathname](ctx));
      [html, title] = renderers[pathname](ctx);
    } else {
      status = 404;
      html = pages.notFoundPage();
      title = '页面不存在';
    }
  } else {
    const guest = GUEST_PAGES[pathname] ?? GUEST_PAGES['/'];
    if (pathname.startsWith('/notes') || pathname.startsWith('/admin')) throw notFound('页面不存在');
    [html, title] = guest();
  }

  if (partial) return { status, html };

  const document = user
    ? renderLayout({ title, pathname, user, content: html, assets, settings: site, initialState: {} })
    : renderGuestLayout({ settings: site, content: html, assets, pathname, initialState: {} });
  return { status, html: document };
}

function matchDetail(pathname) {
  for (const pattern of Object.keys(detailLoaders)) {
    const names = [];
    const source = pattern
      .split('/')
      .map((segment) => {
        if (!segment.startsWith(':')) return segment;
        names.push(segment.slice(1));
        return '([^/]+)';
      })
      .join('/');
    const found = new RegExp(`^${source}/?$`).exec(pathname);
    if (found) return { pattern, params: Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(found[index + 1])])) };
  }
  return null;
}
