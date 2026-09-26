import { Router, readBody } from '../http/router.js';
import * as posts from '../models/posts.js';
import * as comments from '../models/comments.js';
import * as v from '../lib/validate.js';
import HttpError from '../lib/http-error.js';
import { track } from '../models/seed.js';
import { earn } from '../models/points.js';
import { createHash } from 'node:crypto';
import { get } from '../db.js';

const router = new Router();
const VIEW_WINDOW = new Map();

router.use(async (ctx) => {
  const parsed = await readBody(ctx.req);
  ctx.body = parsed.body;
  ctx.files = parsed.files;
});

/** :id 既可能是文章 id 也可能是 slug，统一解析成真实 id */
function resolvePostId(key) {
  const row = get('SELECT id FROM posts WHERE id = ? OR slug = ?', [key, key]);
  if (!row) throw HttpError.notFound('文章不存在');
  return row.id;
}

/* ---------- 分类与标签 ---------- */

router.get('/categories', async (ctx) => ctx.ok({ items: posts.listCategories() }));

router.post('/categories', async (ctx) => {
  if (ctx.user?.role !== 'admin') throw HttpError.forbidden('仅管理员可管理分类');
  const cat = posts.createCategory({
    name: v.str(ctx.body.name, '分类名', { max: 24 }),
    description: v.str(ctx.body.description, '描述', { required: false, max: 200 }),
    color: v.str(ctx.body.color, '颜色', { required: false, max: 20 }) || '#6366f1',
  });
  ctx.created({ category: cat });
});

router.patch('/categories/:id', async (ctx) => {
  if (ctx.user?.role !== 'admin') throw HttpError.forbidden('仅管理员可管理分类');
  ctx.ok({
    category: posts.updateCategory(ctx.params.id, {
      name: ctx.body.name,
      description: ctx.body.description,
      color: ctx.body.color,
    }),
  });
});

router.delete('/categories/:id', async (ctx) => {
  if (ctx.user?.role !== 'admin') throw HttpError.forbidden('仅管理员可管理分类');
  posts.removeCategory(ctx.params.id);
  ctx.ok({ ok: true });
});

router.get('/tags', async (ctx) => ctx.ok({ items: posts.listTags(v.int(ctx.query.limit, 'limit', { min: 1, max: 100, fallback: 50 })) }));

/* ---------- 文章 ---------- */

router.get('/posts', async (ctx) => {
  const result = posts.query({
    page: v.int(ctx.query.page, '页码', { min: 1, fallback: 1 }),
    size: v.int(ctx.query.size, '每页', { min: 1, max: 50, fallback: 10 }),
    status: ctx.query.status || 'published',
    authorId: ctx.query.author || null,
    category: ctx.query.category || null,
    tag: ctx.query.tag || null,
    q: ctx.query.q || '',
    featured: ctx.query.featured === undefined ? null : ctx.query.featured === 'true',
    sort: ctx.query.sort || 'new',
    bookmarksOnly: ctx.query.bookmarked === 'true',
    viewerId: ctx.user?.id || null,
  });
  track('list_posts', { userId: ctx.user?.id, meta: { q: ctx.query.q, category: ctx.query.category } });
  ctx.ok(result);
});

router.get('/posts/featured', async (ctx) => {
  const result = posts.query({ size: 3, featured: true, status: 'published' });
  ctx.ok(result);
});

router.get('/posts/:idOrSlug', async (ctx) => {
  const key = ctx.params.idOrSlug;
  const post = posts.findById(key) || posts.findBySlug(key);
  if (!post) throw HttpError.notFound('文章不存在');
  if (post.status !== 'published' && post.author.id !== ctx.user?.id && ctx.user?.role !== 'admin') {
    throw HttpError.notFound('文章不存在或未发布');
  }

  // 30 分钟内同 IP 只计一次浏览（按文章 id 去重，id 与 slug 访问只计一次）
  const ipKey = `${post.id}:${ctx.ip}`;
  const last = VIEW_WINDOW.get(ipKey);
  const now = Date.now();
  let counted = false;
  if (!last || now - last > 30 * 60 * 1000) {
    VIEW_WINDOW.set(ipKey, now);
    if (VIEW_WINDOW.size > 5000) VIEW_WINDOW.clear();
    posts.incrementView(post.id);
    track('view_post', { userId: ctx.user?.id, target: post.id });
    counted = true;
  }

  ctx.ok({
    post: { ...post, views: counted ? post.views + 1 : post.views },
    adjacent: posts.adjacent(post.id),
    related: posts.related(post.id),
    comments: comments.listByPost(post.id),
    commentCount: comments.countForPost(post.id),
    liked: ctx.user ? posts.reacted(ctx.user.id, post.id) : false,
  });
});

router.post('/posts', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const post = posts.create({
    title: v.str(ctx.body.title, '标题', { max: 120 }),
    content: v.str(ctx.body.content, '正文', { max: 200_000, trim: false }),
    excerpt: v.str(ctx.body.excerpt, '摘要', { required: false, max: 300 }),
    cover: v.url(ctx.body.cover, '封面', { required: false }),
    authorId: ctx.user.id,
    categoryId: ctx.body.categoryId || null,
    status: v.oneOf(ctx.body.status, '状态', ['draft', 'published'], 'draft'),
    tags: v.list(ctx.body.tags, '标签', { max: 8, maxItem: 24 }),
    featured: v.bool(ctx.body.featured),
  });
  track('create_post', { userId: ctx.user.id, target: post.id });
  const reward = earn(ctx.user.id, 'create_post');
  ctx.created({ post, reward });
});

router.put('/posts/:id', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const post = posts.update(
    ctx.params.id,
    {
      title: ctx.body.title === undefined ? undefined : v.str(ctx.body.title, '标题', { max: 120 }),
      content: ctx.body.content === undefined ? undefined : v.str(ctx.body.content, '正文', { max: 200_000, trim: false }),
      excerpt: ctx.body.excerpt === undefined ? undefined : v.str(ctx.body.excerpt, '摘要', { max: 300 }),
      cover: ctx.body.cover,
      categoryId: ctx.body.categoryId,
      status: ctx.body.status ? v.oneOf(ctx.body.status, '状态', ['draft', 'published'], 'draft') : undefined,
      tags: ctx.body.tags ? v.list(ctx.body.tags, '标签', { max: 8, maxItem: 24 }) : undefined,
      featured: ctx.body.featured,
    },
    { authorId: ctx.user.id },
  );
  track('update_post', { userId: ctx.user.id, target: post.id });
  ctx.ok({ post });
});

router.delete('/posts/:id', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const existing = get('SELECT author_id FROM posts WHERE id = ?', [ctx.params.id]);
  if (!existing) throw HttpError.notFound('文章不存在');
  if (existing.author_id !== ctx.user.id && ctx.user.role !== 'admin') throw HttpError.forbidden('只能删除自己的文章');
  posts.remove(ctx.params.id);
  track('delete_post', { userId: ctx.user.id, target: ctx.params.id });
  ctx.ok({ ok: true });
});

router.post('/posts/:id/like', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const result = posts.toggleReaction(ctx.user.id, resolvePostId(ctx.params.id));
  // 被点赞的一方获得积分（同一文章每天最多计 50 次）
  if (result.active && result.authorId && result.authorId !== ctx.user.id) {
    earn(result.authorId, 'receive_like', { detail: '文章被点赞' });
  }
  ctx.ok(result);
});

router.post('/posts/:id/bookmark', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  ctx.ok(posts.toggleBookmark(ctx.user.id, resolvePostId(ctx.params.id)));
});

/* ---------- 评论 ---------- */

router.get('/posts/:id/comments', async (ctx) => {
  const postId = resolvePostId(ctx.params.id);
  ctx.ok({ items: comments.listByPost(postId), total: comments.countForPost(postId) });
});

router.get('/comments/recent', async (ctx) => {
  ctx.ok({ items: comments.recent({ limit: v.int(ctx.query.limit, 'limit', { min: 1, max: 30, fallback: 8 }) }) });
});

router.post('/posts/:id/comments', async (ctx) => {
  const body = v.str(ctx.body.body, '评论内容', { max: 2000, trim: false });
  const guestName = ctx.user ? null : v.str(ctx.body.guestName, '昵称', { max: 24 });
  const ipHash = createHash('sha256').update(ctx.ip + configSalt()).digest('hex').slice(0, 16);
  const comment = comments.create({
    postId: resolvePostId(ctx.params.id),
    authorId: ctx.user?.id || null,
    guestName,
    body,
    parentId: ctx.body.parentId || null,
    ipHash,
  });
  track('create_comment', { userId: ctx.user?.id, target: ctx.params.id });
  const reward = ctx.user ? earn(ctx.user.id, 'create_comment') : null;
  ctx.created({
    comment,
    pending: !ctx.user,
    reward,
    message: ctx.user ? '评论已发布' : '评论已提交，审核通过后显示',
  });
});

router.patch('/comments/:id', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const comment = comments.update(
    ctx.params.id,
    v.str(ctx.body.body, '评论内容', { max: 2000, trim: false }),
    { authorId: ctx.user.id, isAdmin: ctx.user.role === 'admin' },
  );
  ctx.ok({ comment });
});

router.delete('/comments/:id', async (ctx) => {
  if (!ctx.user) throw HttpError.unauthorized();
  const row = get('SELECT c.author_id, p.author_id AS post_author FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?', [
    ctx.params.id,
  ]);
  if (!row) throw HttpError.notFound('评论不存在');
  comments.remove(ctx.params.id, {
    authorId: ctx.user.id,
    isAdmin: ctx.user.role === 'admin',
    postAuthorId: row.post_author,
  });
  ctx.ok({ ok: true });
});

router.post('/comments/:id/like', async (ctx) => {
  const result = comments.like(ctx.params.id);
  const authorId = get('SELECT author_id FROM comments WHERE id = ?', [ctx.params.id])?.author_id ?? null;
  if (ctx.user && authorId && authorId !== ctx.user.id) {
    earn(authorId, 'comment_liked', { detail: '评论被点赞' });
  }
  ctx.ok({ likes: result });
});

function configSalt() {
  return 'hub-salt';
}

export default router;
