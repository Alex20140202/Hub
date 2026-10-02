import * as pages from './pages.js';
import * as blog from './blog.js';
import * as modules from './modules.js';
import { renderLayout, renderGuestLayout } from './layout.js';
import { overview } from '../routes/dashboard.js';
import * as notes from '../models/notes.js';
import * as todos from '../models/todos.js';
import * as links from '../models/links.js';
import * as files from '../models/files.js';
import * as posts from '../models/posts.js';
import * as shorts from '../models/shorts.js';
import * as points from '../models/points.js';
import * as chat from '../models/chat.js';
import * as users from '../models/users.js';
import { get } from '../db.js';
import { getSettings } from '../models/stats.js';
import { notFound, forbidden } from '../lib/http-error.js';
import { config } from '../config.js';
import { chatStats } from '../ws/chat.js';
import { outline } from './markdown.js';

const paging = (query) => ({
  page: Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1),
  size: Math.min(30, Math.max(1, Number.parseInt(query.size ?? '10', 10) || 10)),
});

/* ----------------------------- 登录后的页面加载 ----------------------------- */

const loaders = {
  '/': async (ctx) => {
    if (!ctx.user) return guestHome(ctx);
    const { settings, site, featured, latest, hot, mine, streak, balance, rank } = await homeData(ctx);
    return { ...ctx, data: { settings, site, featured, latest, hot, mine, streak, balance, rank } };
  },

  '/blog': async (ctx) => {
    const result = posts.listPosts({
      q: ctx.query.q ?? '',
      tag: ctx.query.tag ?? '',
      category: ctx.query.category ?? '',
      sort: oneOfQuery(ctx.query.sort, ['recent', 'hot', 'liked', 'title'], 'recent'),
      ...paging(ctx.query),
      viewerId: ctx.user?.id ?? null,
    });
    return { ...ctx, data: { ...result, categories: posts.listCategories(), tags: posts.popularTags(16) } };
  },

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

  '/links': async (ctx) => ({
    ...ctx,
    data: {
      items: links.listLinks(ctx.user.id, {
        q: ctx.query.q ?? '',
        tag: ctx.query.tag ?? '',
        starred: ctx.query.starred === '1',
        sort: ctx.query.sort ?? 'recent',
      }),
      stats: links.linkStats(ctx.user.id),
      tags: links.allTags(ctx.user.id),
    },
  }),

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

  '/short': async (ctx) => ({ ...ctx, data: { items: shorts.listShorts(ctx.user.id), stats: shorts.shortStats(ctx.user.id) } }),

  '/points': async (ctx) => ({
    ...ctx,
    data: {
      overview: { ...points.overview(ctx.user.id), rules: Object.entries(points.RULES).map(([key, rule]) => ({ key, ...rule })) },
      logs: points.listLogs(ctx.user.id, { limit: 12 }),
      leaderboard: points.leaderboard(10),
      items: points.listShopItems(),
      mine: points.myItems(ctx.user.id),
      rank: points.myRank(ctx.user.id),
    },
  }),

  '/chat': async (ctx) => ({
    ...ctx,
    data: { messages: chat.listMessages('lobby', { limit: 50 }), online: chatStats().online, me: ctx.user?.nickname ?? '访客' },
  }),

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
          posts: posts.countPosts(),
          drafts: get("SELECT COUNT(*) AS n FROM posts WHERE status = 'draft'").n,
          notes: get('SELECT COUNT(*) AS n FROM notes').n,
          todos: get('SELECT COUNT(*) AS n FROM todos').n,
          links: get('SELECT COUNT(*) AS n FROM links').n,
          files: get('SELECT COUNT(*) AS n FROM files').n,
          storage: get('SELECT COALESCE(SUM(size), 0) AS n FROM files').n,
          pendingComments: posts.countComments('pending'),
          subscribers: chat.subscriberCount(),
          chat: chatStats(),
        },
        users: users.listUsers(100),
        pending: posts.pendingComments(20),
        shorts: shorts.allShorts(20),
        shop: points.listShopItems(),
        economy: points.economy(),
        site: getSettings(),
      },
    };
  },
};

const renderers = {
  '/': (ctx) => [blog.homePage(ctx), '首页'],
  '/blog': (ctx) => [blog.blogPage(ctx), '博客'],
  '/notes': (ctx) => [pages.notesPage(ctx), '笔记'],
  '/todos': (ctx) => [pages.todosPage(ctx), '待办'],
  '/links': (ctx) => [pages.linksPage(ctx), '书签'],
  '/files': (ctx) => [pages.filesPage(ctx), '文件'],
  '/short': (ctx) => [modules.shortsPage(ctx), '短链'],
  '/points': (ctx) => [modules.pointsPage(ctx), '积分中心'],
  '/chat': (ctx) => [modules.chatPage(ctx), '聊天室'],
  '/search': (ctx) => [pages.searchPage(ctx), '搜索'],
  '/settings': (ctx) => [pages.settingsPage(ctx), '设置'],
  '/admin': (ctx) => [pages.adminPage(ctx), '管理后台'],
};

/* --------------------------------- 子路由 --------------------------------- */

const details = {
  // 注意：更具体的路径必须排在通配之前，否则 /blog/new 会被 /blog/:slug 抢先匹配
  '/blog/new': {
    auth: true,
    load: async (ctx) => ({ ...ctx, data: { post: null } }),
    render: (ctx) => [blog.editorPage(ctx), '写文章'],
  },

  '/blog/:slug': {
    auth: false,
    load: async (ctx) => {
      const viewerId = ctx.user?.id ?? null;
      const post = posts.getPost(ctx.params.slug, viewerId);
      if (!post) throw notFound('文章不存在');
      const isOwner = viewerId && (post.authorId === viewerId || ctx.user.role === 'admin');
      if (post.status !== 'published' && !isOwner) throw notFound('文章不存在');
      // 同 IP 30 分钟只计一次浏览
      if (!ctx.viewed.has(post.id)) {
        ctx.viewed.add(post.id);
        posts.registerView(post.id);
        post.views += 1;
      }
      return {
        ...ctx,
        data: {
          post,
          comments: posts.listComments(post.id, { includePending: Boolean(isOwner) }),
          outline: outline(post.body),
        },
      };
    },
    render: (ctx) => [blog.postPage(ctx), ctx.data.post.title],
  },

  '/blog/:id/edit': {
    auth: true,
    load: async (ctx) => {
      const post = posts.getPost(Number(ctx.params.id) || ctx.params.id);
      if (!post) throw notFound('文章不存在');
      if (post.authorId !== ctx.user.id && ctx.user.role !== 'admin') throw forbidden('只能编辑自己的文章');
      return { ...ctx, data: { post } };
    },
    render: (ctx) => [blog.editorPage(ctx), '编辑文章'],
  },

  '/notes/:id': {
    auth: true,
    load: async (ctx) => {
      const note = notes.getNote(Number(ctx.params.id), ctx.user.id);
      if (!note) throw notFound('笔记不存在');
      return { ...ctx, data: { note } };
    },
    render: (ctx) => [pages.noteDetail(ctx), ctx.data.note.title || '笔记'],
  },

  '/u/:username': {
    auth: false,
    load: async (ctx) => {
      const profile = users.findProfile(ctx.params.username);
      if (!profile) throw notFound('用户不存在');
      return {
        ...ctx,
        data: {
          profile,
          stats: { ...posts.archiveStats(profile.id), links: links.linkStats(profile.id).total, notes: notes.countNotes(profile.id) },
          notes: notes.recentNotes(profile.id, 5),
          articles: posts.listPosts({ authorId: profile.id, size: 5 }).items,
        },
      };
    },
    render: (ctx) => [pages.userPage(ctx), ctx.data.profile.nickname],
  },

  '/d/:id': {
    auth: false,
    load: async (ctx) => {
      const file = files.getPublicFile(Number(ctx.params.id));
      if (!file) throw notFound('文件不存在或未开放分享');
      const owner = users.findById(file.userId) ?? { nickname: '未知用户' };
      return { ...ctx, data: { file, owner } };
    },
    render: (ctx) => [modules.sharePage(ctx), '文件分享'],
  },
};

/* --------------------------------- 访客页面 --------------------------------- */

const GUEST = {
  '/login': () => [pages.authPage({ mode: 'login', site: getSettings() }), '登录'],
  '/chat': () => [
    modules.chatPage({ user: null, query: {}, data: { messages: chat.listMessages('lobby', { limit: 50 }), online: chatStats().online, me: '访客' } }),
    '聊天室',
  ],
  '/register': () => [pages.authPage({ mode: 'register', site: getSettings() }), '注册'],
  '/blog': () => {
    const result = posts.listPosts({ size: 10, sort: 'recent' });
    return [
      blog.blogPage({ user: null, query: {}, data: { ...result, categories: posts.listCategories(), tags: posts.popularTags(16) } }),
      '博客',
    ];
  },
};

/* ---------------------------------- 组装 ---------------------------------- */

function oneOfQuery(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

async function homeData(ctx) {
  const settings = getSettings();
  return {
    settings,
    site: {
      users: users.countUsers(),
      posts: posts.countPosts(),
      tags: posts.popularTags(12),
      categories: posts.listCategories(),
      chat: chatStats(),
    },
    featured: posts.featuredPosts(3),
    latest: posts.listPosts({ size: 6, sort: 'recent' }).items,
    hot: posts.listPosts({ size: 4, sort: 'hot' }).items,
    mine: {
      notes: notes.countNotes(ctx.user.id),
      posts: posts.archiveStats(ctx.user.id),
      balance: points.balanceOf(ctx.user.id),
      rank: points.myRank(ctx.user.id),
      storage: files.storageStats(ctx.user.id).used,
    },
    streak: overview(ctx.user.id).streak,
    balance: points.balanceOf(ctx.user.id),
    rank: points.myRank(ctx.user.id),
  };
}

const guestData = () => ({
  settings: getSettings(),
  site: { users: users.countUsers(), posts: posts.countPosts(), tags: posts.popularTags(12), categories: posts.listCategories(), chat: chatStats() },
  featured: posts.featuredPosts(3),
  latest: posts.listPosts({ size: 6, sort: 'recent' }).items,
  hot: posts.listPosts({ size: 4, sort: 'hot' }).items,
  mine: null,
});

const guestHome = async (ctx) => {
  const data = guestData();
  return { ...ctx, data: { ...data, streak: 0, balance: 0, rank: null } };
};

/**
 * 渲染页面 HTML。服务端是标记的唯一来源：客户端换页时用 `?_partial=1`
 * 只取内容片段，首屏则输出完整外壳。
 */
export async function renderPage({ pathname, user, query, params, sessionId, assets, partial, viewed }) {
  // 子路由参数（/blog/:slug、/u/:username 等）必须并入 ctx.params
  const ctx = { pathname, query, params: { ...params }, user, sessionId, viewed: viewed ?? new Set() };
  let status = 200;
  let html = '';
  let title = '';

  if (user) {
    const detail = matchDetail(pathname, details);
    if (detail) {
      ctx.params = { ...ctx.params, ...detail.params };
      Object.assign(ctx, await detail.entry.load(ctx));
      [html, title] = detail.entry.render(ctx);
    } else if (loaders[pathname]) {
      Object.assign(ctx, await loaders[pathname](ctx));
      [html, title] = renderers[pathname](ctx);
    } else {
      status = 404;
      html = pages.notFoundPage();
      title = '页面不存在';
    }
  } else {
    // 访客：只开放首页、登录注册、博客
    if (pathname === '/') {
      Object.assign(ctx, await guestHome(ctx));
      [html, title] = renderers['/'](ctx);
    } else if (GUEST[pathname]) {
      [html, title] = GUEST[pathname]();
    } else if (pathname.startsWith('/blog/')) {
      const detail = matchDetail(pathname, details);
      if (detail) {
        ctx.params = { ...ctx.params, ...detail.params };
        Object.assign(ctx, await detail.entry.load(ctx));
        [html, title] = detail.entry.render(ctx);
      } else {
        status = 404;
        html = pages.notFoundPage();
        title = '文章不存在';
      }
    } else {
      status = 404;
      html = pages.notFoundPage();
      title = '页面不存在';
    }
  }

  if (partial) return { status, html };

  const document = user
    ? renderLayout({ title, pathname, user, content: html, assets, settings: getSettings(), initialState: {} })
    : renderGuestLayout({ settings: getSettings(), content: html, assets, pathname, initialState: {} });
  return { status, html: document };
}

function matchDetail(pathname, table) {
  for (const pattern of Object.keys(table)) {
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
    if (found) {
      return {
        entry: table[pattern],
        params: Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(found[index + 1])])),
      };
    }
  }
  return null;
}

export { details, loaders, guestData, homeData };
