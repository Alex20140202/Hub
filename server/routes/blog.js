import { notFound, forbidden, badRequest } from '../lib/http-error.js';
import { createLimiter } from '../lib/rate-limit.js';
import { str, oneOf, bool, int, tags as vTags, logEvent } from '../lib/validate.js';
import * as posts from '../models/posts.js';
import * as points from '../models/points.js';
import { recordEvent } from '../models/stats.js';

const commentLimiter = createLimiter({ windowMs: 60_000, max: 10, name: 'comment' });
const publishLimiter = createLimiter({ windowMs: 60_000, max: 20, name: 'publish' });

const excerpt = (body, max = 140) => {
  const text = String(body || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>#\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const categoryIdOf = (name) => {
  if (!name) return null;
  const existing = posts.listCategories().find((item) => item.slug === name || item.name === name);
  if (existing) return existing.id;
  return posts.createCategory(name).id;
};

/* ---------------------------------- 文章 ---------------------------------- */

export function registerBlog(router) {
  router.get('/api/posts', async (ctx) => {
    const page = int(ctx.query.page, '页码', { min: 1, fallback: 1 });
    const size = int(ctx.query.size, '每页', { min: 1, max: 50, fallback: 10 });
    const result = posts.listPosts({
      q: ctx.query.q ?? '',
      tag: ctx.query.tag ?? '',
      category: ctx.query.category ?? '',
      sort: oneOf(ctx.query.sort, '排序', ['recent', 'hot', 'liked', 'title'], 'recent'),
      page,
      size,
      viewerId: ctx.user?.id ?? null,
    });
    ctx.json(200, result);
  });

  router.get('/api/posts/featured', async (ctx) => {
    ctx.json(200, { items: posts.featuredPosts(int(ctx.query.limit, '数量', { min: 1, max: 10, fallback: 3 })) });
  });

  router.get('/api/posts/meta', async (ctx) => {
    ctx.json(200, { categories: posts.listCategories(), tags: posts.popularTags(24) });
  });

  router.get('/api/posts/:idOrSlug', async (ctx) => {
    const viewerId = ctx.user?.id ?? null;
    const post = posts.getPost(ctx.params.idOrSlug, viewerId);
    if (!post || (post.status !== 'published' && post.authorId !== viewerId && ctx.user?.role !== 'admin')) {
      throw notFound('文章不存在');
    }
    // 同 IP 30 分钟内只计一次浏览
    const viewKey = `view:${post.id}:${ctx.clientIp}`;
    if (!viewLimiter.take(viewKey)) {
      posts.registerView(post.id);
      post.views += 1;
    }
    ctx.json(200, { post, comments: posts.listComments(post.id, { includePending: viewerId === post.authorId }) });
  });

  router.post('/api/posts', async (ctx) => {
    const user = ctx.requireUser();
    if (publishLimiter.take(user.id)) throw badRequest('发布太频繁了，稍后再试');
    const body = await ctx.input();
    const status = oneOf(body.status, '状态', ['draft', 'published'], 'published');
    const post = posts.createPost(user.id, {
      title: str(body.title, '标题', { max: 160 }),
      body: str(body.body, '正文', { max: 100000, required: false, fallback: '' }),
      excerpt: body.excerpt ? str(body.excerpt, '摘要', { max: 300, required: false, fallback: '' }) : undefined,
      tags: vTags(body.tags ?? ''),
      categoryId: categoryIdOf(body.category),
      status,
    });
    if (status === 'published') {
      const result = points.award(user.id, 'post.publish', { note: `发布文章《${post.title}》` });
      post.pointsGained = result.granted;
    }
    recordEvent(user.id, 'post.publish', post.title);
    ctx.json(201, { post });
  });

  router.put('/api/posts/:id', async (ctx) => {
    const user = ctx.requireUser();
    const id = Number(ctx.params.id);
    const current = posts.getPost(id);
    if (!current) throw notFound('文章不存在');
    if (current.authorId !== user.id && user.role !== 'admin') throw forbidden('只能编辑自己的文章');

    const body = await ctx.input();
    const patch = {};
    if (body.title !== undefined) patch.title = str(body.title, '标题', { max: 160 });
    if (body.body !== undefined) patch.body = str(body.body, '正文', { max: 100000, required: false, fallback: '' });
    if (body.excerpt !== undefined) patch.excerpt = str(body.excerpt, '摘要', { max: 300, required: false, fallback: '' });
    if (body.tags !== undefined) patch.tags = vTags(body.tags);
    if (body.status !== undefined) patch.status = oneOf(body.status, '状态', ['draft', 'published']);
    if (body.category !== undefined) patch.categoryId = categoryIdOf(body.category);

    const post = posts.updatePost(id, user.id, patch);
    if (patch.status === 'published' && current.status !== 'published') {
      recordEvent(user.id, 'post.publish', post.title);
      points.award(user.id, 'post.publish', { note: `发布文章《${post.title}》` });
    } else {
      recordEvent(user.id, 'post.update', post.title);
    }
    ctx.json(200, { post });
  });

  router.delete('/api/posts/:id', async (ctx) => {
    const user = ctx.requireUser();
    const post = posts.getPost(Number(ctx.params.id));
    if (!post) throw notFound('文章不存在');
    if (post.authorId !== user.id && user.role !== 'admin') throw forbidden('只能删除自己的文章');
    posts.deletePost(post.id);
    recordEvent(user.id, 'post.delete', post.title);
    ctx.json(200, { ok: true });
  });

  router.post('/api/posts/:id/like', async (ctx) => {
    const user = ctx.requireUser();
    const post = posts.getPost(Number(ctx.params.id));
    if (!post) throw notFound('文章不存在');
    const result = posts.toggleReaction('post', post.id, user.id);
    if (result.liked && post.authorId !== user.id) {
      const gained = points.award(post.authorId, 'post.liked', { note: `《${post.title}》被点赞` });
      if (gained.granted) notifyOwner(post.authorId, { type: 'points', delta: gained.granted, balance: gained.balance, reason: '文章被点赞' });
    }
    ctx.json(200, result);
  });

  router.post('/api/posts/:id/bookmark', async (ctx) => {
    const user = ctx.requireUser();
    const post = posts.getPost(Number(ctx.params.id));
    if (!post) throw notFound('文章不存在');
    ctx.json(200, posts.toggleBookmark(post.id, user.id));
  });

  router.get('/api/bookmarks', async (ctx) => {
    const user = ctx.requireUser();
    ctx.json(200, { items: posts.listBookmarks(user.id) });
  });
}

const viewLimiter = createLimiter({ windowMs: 30 * 60_000, max: 1, name: 'post-view' });

/** 私信推送（当前走 WebSocket 广播的简化版，直接写库 + 广播给房间）。 */
const notifyOwner = (userId, payload) => {
  try {
    pushToRoom(`u${userId}`, payload);
  } catch {
    /* 用户不在线则忽略 */
  }
};

let pushToRoom = () => {};
export const bindPush = (fn) => {
  pushToRoom = fn;
};

/* ---------------------------------- 评论 ---------------------------------- */

export function registerComments(router) {
  router.get('/api/posts/:id/comments', async (ctx) => {
    const post = posts.getPost(ctx.params.id);
    if (!post) throw notFound('文章不存在');
    ctx.json(200, { items: posts.listComments(post.id, { includePending: Boolean(ctx.user) }) });
  });

  router.post('/api/posts/:id/comments', async (ctx) => {
    const post = posts.getPost(ctx.params.id);
    if (!post) throw notFound('文章不存在');
    if (commentLimiter.take(ctx.clientIp)) throw badRequest('评论太频繁了，歇一会儿');

    const body = await ctx.input();
    const user = ctx.user ?? null;
    // 游客评论进入待审核，登录用户直接通过
    const status = user ? 'approved' : 'pending';
    const guestName = user ? '' : str(body.guestName, '昵称', { max: 24, required: false, fallback: '匿名读者' });

    const comment = posts.createComment(post.id, {
      authorId: user?.id ?? null,
      guestName,
      body: str(body.body, '评论内容', { max: 2000 }),
      parentId: body.parentId ? Number(body.parentId) : null,
      status,
    });
    if (status === 'approved' && post.authorId !== user?.id) {
      points.award(post.authorId, 'comment.create', { note: `《${post.title}》收到新评论` });
      recordEvent(post.authorId, 'comment.received', post.title);
    }
    ctx.json(201, { comment, pending: status === 'pending' });
  });

  router.patch('/api/comments/:id', async (ctx) => {
    const user = ctx.requireUser();
    const comment = posts.commentAuthor(ctx.params.id);
    if (!comment) throw notFound('评论不存在');
    if (comment.authorId !== user.id && user.role !== 'admin') throw forbidden('只能编辑自己的评论');
    const body = await ctx.input();
    if (!posts.updateComment(Number(ctx.params.id), str(body.body, '评论内容', { max: 2000 }))) throw notFound('评论不存在');
    ctx.json(200, { ok: true });
  });

  router.post('/api/comments/:id/like', async (ctx) => {
    const user = ctx.requireUser();
    const comment = posts.commentAuthor(ctx.params.id);
    if (!comment) throw notFound('评论不存在');
    const result = posts.toggleReaction('comment', Number(ctx.params.id), user.id);
    if (result.liked && comment.authorId && comment.authorId !== user.id) {
      points.award(comment.authorId, 'comment.liked', { note: '评论被点赞' });
    }
    ctx.json(200, result);
  });

  router.delete('/api/comments/:id', async (ctx) => {
    const user = ctx.requireUser();
    const comment = posts.commentAuthor(ctx.params.id);
    if (!comment) throw notFound('评论不存在');
    if (comment.authorId !== user.id && user.role !== 'admin') throw forbidden('只能删除自己的评论');
    posts.deleteComment(Number(ctx.params.id));
    ctx.json(200, { ok: true });
  });
}

/* ------------------------------ 分类与标签管理 ------------------------------ */

export function registerTaxonomy(router) {
  router.get('/api/categories', async (ctx) => ctx.json(200, { items: posts.listCategories() }));

  router.post('/api/categories', async (ctx) => {
    ctx.requireAdmin();
    const body = await ctx.input();
    ctx.json(201, { category: posts.createCategory(str(body.name, '分类名', { max: 40 }), str(body.description, '描述', { max: 200, required: false, fallback: '' })) });
  });

  router.patch('/api/categories/:id', async (ctx) => {
    ctx.requireAdmin();
    const body = await ctx.input();
    const category = posts.updateCategory(Number(ctx.params.id), {
      name: body.name === undefined ? undefined : str(body.name, '分类名', { max: 40 }),
      description: body.description === undefined ? undefined : str(body.description, '描述', { max: 200, required: false, fallback: '' }),
    });
    if (!category) throw notFound('分类不存在');
    ctx.json(200, { category });
  });

  router.delete('/api/categories/:id', async (ctx) => {
    ctx.requireAdmin();
    if (!posts.deleteCategory(Number(ctx.params.id))) throw notFound('分类不存在');
    ctx.json(200, { ok: true });
  });
}

/* --------------------------------- 积分中心 --------------------------------- */

export function registerPoints(router) {
  router.get('/api/points/overview', async (ctx) => {
    const user = ctx.requireUser();
    ctx.json(200, {
      ...points.overview(user.id),
      recent: points.listLogs(user.id, { limit: 8 }).items,
      leaderboard: points.leaderboard(8),
      rules: Object.entries(points.RULES).map(([key, rule]) => ({ key, ...rule })),
    });
  });

  router.post('/api/points/checkin', async (ctx) => {
    const user = ctx.requireUser();
    const result = points.checkin(user.id);
    if (!result.already) recordEvent(user.id, 'point.checkin', `签到 +${result.reward}`);
    ctx.json(200, result);
  });

  router.get('/api/points/logs', async (ctx) => {
    const user = ctx.requireUser();
    ctx.json(
      200,
      points.listLogs(user.id, {
        limit: int(ctx.query.limit, '每页', { min: 1, max: 50, fallback: 20 }),
        page: int(ctx.query.page, '页码', { min: 1, fallback: 1 }),
      }),
    );
  });

  router.get('/api/points/leaderboard', async (ctx) => {
    ctx.json(200, { items: points.leaderboard(int(ctx.query.limit, '数量', { min: 1, max: 50, fallback: 10 })) });
  });

  router.get('/api/shop/items', async (ctx) => {
    const items = points.listShopItems();
    ctx.json(200, { items: ctx.user ? items.map((item) => ({ ...item, owned: points.ownsItem(item.id, ctx.user.id) })) : items });
  });

  router.get('/api/shop/mine', async (ctx) => {
    const user = ctx.requireUser();
    ctx.json(200, { items: points.myItems(user.id), balance: points.balanceOf(user.id) });
  });

  router.post('/api/shop/redeem/:itemId', async (ctx) => {
    const user = ctx.requireUser();
    const result = points.redeem(user.id, Number(ctx.params.itemId));
    if (!result.ok) throw badRequest(result.error);
    recordEvent(user.id, 'shop.redeem', result.item.name);
    ctx.json(201, result);
  });

  router.post('/api/shop/use/:ownedId', async (ctx) => {
    const user = ctx.requireUser();
    const result = points.useOwned(user.id, Number(ctx.params.ownedId));
    if (!result.ok) throw badRequest(result.error);
    ctx.json(200, result);
  });
}
