import { all, get, run } from '../db.js';
import { randomId, slugify, nowIso } from '../lib/id.js';
import HttpError from '../lib/http-error.js';
import { touchPostCount } from './users.js';

/* ---------- 分类 / 标签 ---------- */

export function listCategories() {
  return all(
    `SELECT c.*, (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND p.status='published') AS count
     FROM categories c ORDER BY count DESC, c.name`,
  );
}

export function createCategory({ name, description = '', color = '#6366f1' }) {
  const slug = slugify(name, 'cat');
  if (get('SELECT id FROM categories WHERE slug = ? OR name = ?', [slug, name])) {
    throw HttpError.conflict('同名分类已存在');
  }
  const id = randomId(8);
  run('INSERT INTO categories (id, name, slug, description, color, created_at) VALUES (?,?,?,?,?,?)', [
    id,
    name,
    slug,
    description,
    color,
    nowIso(),
  ]);
  return get('SELECT * FROM categories WHERE id = ?', [id]);
}

export function updateCategory(id, patch) {
  const cat = get('SELECT * FROM categories WHERE id = ?', [id]);
  if (!cat) throw HttpError.notFound('分类不存在');
  run('UPDATE categories SET name = ?, description = ?, color = ? WHERE id = ?', [
    patch.name ?? cat.name,
    patch.description ?? cat.description,
    patch.color ?? cat.color,
    id,
  ]);
  return get('SELECT * FROM categories WHERE id = ?', [id]);
}

export function removeCategory(id) {
  run('DELETE FROM categories WHERE id = ?', [id]);
  return true;
}

export function listTags(limit = 50) {
  return all(
    `SELECT t.*, (SELECT COUNT(*) FROM post_tags pt WHERE pt.tag_id = t.id) AS count
     FROM tags t ORDER BY count DESC, t.name LIMIT ?`,
    [limit],
  );
}

export function ensureTag(name) {
  const clean = String(name).trim().slice(0, 24);
  if (!clean) return null;
  const found = get('SELECT * FROM tags WHERE name = ?', [clean]);
  if (found) return found;
  const id = randomId(8);
  run('INSERT INTO tags (id, name, slug, created_at) VALUES (?,?,?,?)', [
    id,
    clean,
    slugify(clean, 'tag'),
    nowIso(),
  ]);
  return get('SELECT * FROM tags WHERE id = ?', [id]);
}

function tagsOfPost(postId) {
  return all(
    'SELECT t.id, t.name, t.slug FROM tags t JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ?',
    [postId],
  );
}

function setPostTags(postId, tags = []) {
  run('DELETE FROM post_tags WHERE post_id = ?', [postId]);
  for (const name of tags.slice(0, 8)) {
    const tag = ensureTag(name);
    if (tag) run('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?,?)', [postId, tag.id]);
  }
}

/* ---------- 文章 ---------- */

const BASE_SELECT = `
  SELECT p.*,
         u.username, u.nickname, u.avatar_color,
         c.name AS category_name, c.slug AS category_slug, c.color AS category_color
  FROM posts p
  JOIN users u ON u.id = p.author_id
  LEFT JOIN categories c ON c.id = p.category_id
`;

function shape(row, { withContent = true } = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    cover: row.cover,
    status: row.status,
    featured: !!row.featured,
    views: row.views,
    likes: row.likes,
    readingTime: row.reading_time,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: {
      id: row.author_id,
      username: row.username,
      nickname: row.nickname,
      avatarColor: row.avatar_color,
    },
    category: row.category_id
      ? { id: row.category_id, name: row.category_name, slug: row.category_slug, color: row.category_color }
      : null,
  };
  if (withContent) out.content = row.content;
  return out;
}

export function query({
  page = 1,
  size = 10,
  status = 'published',
  authorId = null,
  category = null,
  tag = null,
  q = '',
  featured = null,
  sort = 'new',
  bookmarksOnly = false,
  viewerId = null,
} = {}) {
  const where = [];
  const params = [];
  if (status && status !== 'all') {
    where.push('p.status = ?');
    params.push(status);
  }
  if (authorId) {
    where.push('p.author_id = ?');
    params.push(authorId);
  }
  if (category) {
    where.push('c.slug = ?');
    params.push(category);
  }
  if (tag) {
    where.push('p.id IN (SELECT post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.slug = ?)');
    params.push(tag);
  }
  if (featured !== null) {
    where.push('p.featured = ?');
    params.push(featured ? 1 : 0);
  }
  if (q) {
    where.push('(p.title LIKE ? OR p.content LIKE ? OR p.excerpt LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (bookmarksOnly && viewerId) {
    where.push('p.id IN (SELECT post_id FROM bookmarks WHERE user_id = ?)');
    params.push(viewerId);
  }
  const orderMap = {
    new: 'p.published_at DESC, p.created_at DESC',
    hot: 'p.views DESC, p.likes DESC',
    likes: 'p.likes DESC',
    comments: '(SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) DESC',
  };
  const order = orderMap[sort] || orderMap.new;
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(
    `SELECT COUNT(*) AS c FROM posts p LEFT JOIN categories c ON c.id = p.category_id ${clause}`,
    params,
  ).c;
  const rows = all(
    `${BASE_SELECT} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, size, (page - 1) * size],
  );
  return {
    items: rows.map((r) => ({ ...shape(r, { withContent: false }), tags: tagsOfPost(r.id) })),
    total,
    page,
    size,
    pages: Math.max(1, Math.ceil(total / size)),
  };
}

export function findById(id) {
  const row = get(`${BASE_SELECT} WHERE p.id = ?`, [id]);
  if (!row) return null;
  return { ...shape(row), tags: tagsOfPost(id) };
}

export function findBySlug(slug) {
  const row = get(`${BASE_SELECT} WHERE p.slug = ?`, [slug]);
  if (!row) return null;
  return { ...shape(row), tags: tagsOfSlug(slug) };
}

function tagsOfSlug(slug) {
  return all(
    `SELECT t.id, t.name, t.slug FROM tags t
     JOIN post_tags pt ON pt.tag_id = t.id
     JOIN posts p ON p.id = pt.post_id WHERE p.slug = ?`,
    [slug],
  );
}

export function adjacent(id) {
  const row = get('SELECT created_at FROM posts WHERE id = ?', [id]);
  if (!row) return { prev: null, next: null };
  const prev = get(
    "SELECT id, title, slug FROM posts WHERE status='published' AND created_at > ? ORDER BY created_at ASC LIMIT 1",
    [row.created_at],
  );
  const next = get(
    "SELECT id, title, slug FROM posts WHERE status='published' AND created_at < ? ORDER BY created_at DESC LIMIT 1",
    [row.created_at],
  );
  return { prev, next };
}

export function create({ title, content, excerpt, cover = null, authorId, categoryId = null, status = 'draft', tags = [], featured = false }) {
  const id = randomId(10);
  const base = slugify(title, 'post');
  let slug = base;
  let i = 1;
  while (get('SELECT id FROM posts WHERE slug = ?', [slug])) slug = `${base}-${++i}`;
  const now = nowIso();
  const readingTime = Math.max(1, Math.round(content.replace(/\s+/g, ' ').length / 400));
  run(
    `INSERT INTO posts (id, title, slug, excerpt, content, cover, author_id, category_id, status, featured, views, likes, reading_time, published_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,?)`,
    [
      id,
      title,
      slug,
      excerpt || content.replace(/[#*`>|\n-]/g, ' ').trim().slice(0, 120),
      content,
      cover,
      authorId,
      categoryId,
      status,
      featured ? 1 : 0,
      readingTime,
      status === 'published' ? now : null,
      now,
      now,
    ],
  );
  setPostTags(id, tags);
  if (status === 'published') touchPostCount(authorId, 1);
  return findById(id);
}

export function update(id, patch, { authorId = null } = {}) {
  const post = get('SELECT * FROM posts WHERE id = ?', [id]);
  if (!post) throw HttpError.notFound('文章不存在');
  if (authorId && post.author_id !== authorId) throw HttpError.forbidden('只能编辑自己的文章');

  const nextStatus = patch.status ?? post.status;
  const next = {
    title: patch.title ?? post.title,
    content: patch.content ?? post.content,
    excerpt: patch.excerpt ?? post.excerpt,
    cover: patch.cover === undefined ? post.cover : patch.cover,
    category_id: patch.categoryId === undefined ? post.category_id : patch.categoryId,
    featured: patch.featured === undefined ? post.featured : patch.featured ? 1 : 0,
    published_at: post.published_at || (nextStatus === 'published' ? nowIso() : null),
  };
  next.reading_time = Math.max(1, Math.round(next.content.replace(/\s+/g, ' ').length / 400));
  run(
    `UPDATE posts SET title=?, content=?, excerpt=?, cover=?, category_id=?, featured=?, reading_time=?, published_at=?, status=?, updated_at=?
     WHERE id = ?`,
    [
      next.title,
      next.content,
      next.excerpt,
      next.cover,
      next.category_id,
      next.featured,
      next.reading_time,
      next.published_at,
      nextStatus,
      nowIso(),
      id,
    ],
  );
  if (patch.tags) setPostTags(id, patch.tags);
  if (post.status !== nextStatus) {
    touchPostCount(post.author_id, nextStatus === 'published' ? 1 : -1);
  }
  return findById(id);
}

export function remove(id) {
  const post = get('SELECT author_id, status FROM posts WHERE id = ?', [id]);
  if (!post) throw HttpError.notFound('文章不存在');
  run('DELETE FROM posts WHERE id = ?', [id]);
  if (post.status === 'published') touchPostCount(post.author_id, -1);
  return true;
}

export function incrementView(id) {
  run('UPDATE posts SET views = views + 1 WHERE id = ?', [id]);
  return get('SELECT views FROM posts WHERE id = ?', [id])?.views ?? 0;
}

export function toggleReaction(userId, postId, kind = 'like') {
  const existing = get('SELECT 1 AS x FROM reactions WHERE user_id = ? AND post_id = ? AND kind = ?', [
    userId,
    postId,
    kind,
  ]);
  if (existing) {
    run('DELETE FROM reactions WHERE user_id = ? AND post_id = ? AND kind = ?', [userId, postId, kind]);
    run('UPDATE posts SET likes = MAX(0, likes - 1) WHERE id = ?', [postId]);
    return { active: false, likes: get('SELECT likes FROM posts WHERE id = ?', [postId]).likes };
  }
  run('INSERT INTO reactions (user_id, post_id, kind) VALUES (?,?,?)', [userId, postId, kind]);
  run('UPDATE posts SET likes = likes + 1 WHERE id = ?', [postId]);
  return { active: true, likes: get('SELECT likes FROM posts WHERE id = ?', [postId]).likes };
}

export function reacted(userId, postId, kind = 'like') {
  return !!get('SELECT 1 AS x FROM reactions WHERE user_id = ? AND post_id = ? AND kind = ?', [
    userId,
    postId,
    kind,
  ]);
}

export function toggleBookmark(userId, postId) {
  const existing = get('SELECT 1 AS x FROM bookmarks WHERE user_id = ? AND post_id = ?', [userId, postId]);
  if (existing) {
    run('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?', [userId, postId]);
    return { bookmarked: false };
  }
  run('INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?,?,?)', [userId, postId, nowIso()]);
  return { bookmarked: true };
}

export function related(postId, limit = 4) {
  return all(
    `${BASE_SELECT}
     WHERE p.status='published' AND p.id != ?
       AND (p.category_id = (SELECT category_id FROM posts WHERE id = ?) OR p.id IN (SELECT post_id FROM post_tags WHERE tag_id IN (SELECT tag_id FROM post_tags WHERE post_id = ?)))
     ORDER BY p.views DESC LIMIT ?`,
    [postId, postId, postId, limit],
  ).map((r) => shape(r, { withContent: false }));
}

export function archive() {
  const rows = all(
    `SELECT substr(COALESCE(published_at, created_at),1,7) AS month, COUNT(*) AS c
     FROM posts WHERE status='published' GROUP BY month ORDER BY month DESC LIMIT 12`,
  );
  return rows.reverse();
}
