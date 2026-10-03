import { all, get, run, tx } from '../db.js';
import { newSlug } from '../lib/slug.js';

/* --------------------------------- 分类与标签 --------------------------------- */

export const listCategories = () => all('SELECT * FROM categories ORDER BY position, name');
export const createCategory = (name, description = '') => {
  const { lastInsertRowid } = run('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)', name, newSlug(name), description);
  return get('SELECT * FROM categories WHERE id = ?', lastInsertRowid);
};
export const updateCategory = (id, { name, description }) => {
  const current = get('SELECT * FROM categories WHERE id = ?', id);
  if (!current) return null;
  run('UPDATE categories SET name = ?, description = ?, slug = ? WHERE id = ?', name ?? current.name, description ?? current.description, name ? newSlug(name) : current.slug, id);
  return get('SELECT * FROM categories WHERE id = ?', id);
};
export const deleteCategory = (id) => run('DELETE FROM categories WHERE id = ?', id).changes > 0;

export const listTags = () => all('SELECT * FROM tags ORDER BY name');
export const ensureTag = (name) => {
  const existing = get('SELECT * FROM tags WHERE name = ?', name);
  if (existing) return existing;
  const { lastInsertRowid } = run('INSERT INTO tags (name, slug) VALUES (?, ?)', name, newSlug(name));
  return get('SELECT * FROM tags WHERE id = ?', lastInsertRowid);
};

export const popularTags = (limit = 20) =>
  all(
    `SELECT t.id, t.name, COUNT(pt.post_id) AS count
       FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
       JOIN posts p ON p.id = pt.post_id AND p.status = 'published'
      GROUP BY t.id ORDER BY count DESC, t.name LIMIT ?`,
    limit,
  );

/* ----------------------------------- 文章 ----------------------------------- */

const COLUMNS = `p.id, p.author_id AS authorId, p.title, p.slug, p.excerpt, p.body, p.cover_hue AS coverHue,
  p.status, p.featured, p.views, p.created_at AS createdAt, p.updated_at AS updatedAt, p.published_at AS publishedAt,
  u.nickname AS authorName, u.username AS authorUsername, u.avatar_hue AS authorHue, u.frame AS authorFrame, u.title AS authorTitle,
  c.name AS categoryName, c.slug AS categorySlug`;

const decorate = (row, { withBody = false } = {}) => {
  if (!row) return null;
  const tags = all(
    `SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ? ORDER BY t.name`,
    row.id,
  ).map((tag) => tag.name);
  const post = { ...row, featured: Boolean(row.featured), tags, wordCount: countWords(row.body) };
  if (!withBody) delete post.body;
  return post;
};

const countWords = (body) => String(body || '').replace(/\s+/g, '').length;

export function listPosts({ q = '', tag = '', category = '', sort = 'recent', authorId = null, featured = false, page = 1, size = 10, viewerId = null } = {}) {
  const where = ["p.status = 'published'"];
  const params = [];

  if (q) {
    where.push('(p.title LIKE ? OR p.excerpt LIKE ? OR p.body LIKE ?)');
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    params.push(like, like, like);
  }
  if (category) {
    where.push('c.slug = ?');
    params.push(category);
  }
  if (tag) {
    where.push('EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id AND t.slug = ?)');
    params.push(newSlug(tag));
  }
  if (authorId) {
    where.push('p.author_id = ?');
    params.push(authorId);
  }
  if (featured) where.push('p.featured = 1');

  const orders = {
    recent: 'p.published_at DESC, p.id DESC',
    hot: 'p.views DESC, p.published_at DESC',
    liked: 'likeCount DESC, p.published_at DESC',
    title: 'p.title COLLATE NOCASE ASC',
  };
  const order = orders[sort] ?? orders.recent;
  const offset = (Math.max(1, page) - 1) * size;

  const rows = all(
    `SELECT ${COLUMNS},
       (SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id AND c2.status = 'approved') AS commentCount,
       (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'post' AND r.target_id = p.id) AS likeCount,
       (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id) AS bookmarkCount
     FROM posts p
     JOIN users u ON u.id = p.author_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}
     LIMIT ? OFFSET ?`,
    ...params,
    size,
    offset,
  );

  const total = get(
    `SELECT COUNT(*) AS n FROM posts p LEFT JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}`,
    ...params,
  ).n;

  return {
    items: rows.map((row) => decorate(viewerId ? withViewerState(row, viewerId) : row)),
    total,
    page: Math.max(1, page),
    pages: Math.max(1, Math.ceil(total / size)),
  };
}

function withViewerState(row, viewerId) {
  return {
    ...row,
    liked: Boolean(get("SELECT 1 AS x FROM reactions WHERE target_type = 'post' AND target_id = ? AND user_id = ?", row.id, viewerId)),
    bookmarked: Boolean(get('SELECT 1 AS x FROM bookmarks WHERE post_id = ? AND user_id = ?', row.id, viewerId)),
  };
}

export const getPost = (idOrSlug, viewerId = null) => {
  const row = get(`SELECT ${COLUMNS} FROM posts p JOIN users u ON u.id = p.author_id LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ? OR p.slug = ?`, idOrSlug, idOrSlug);
  if (!row) return null;
  return decorate(viewerId ? withViewerState(row, viewerId) : row, { withBody: true });
};

export function createPost(authorId, input) {
  const result = tx(() => {
    const categoryId = input.categoryId ?? null;
    const { lastInsertRowid } = run(
      `INSERT INTO posts (author_id, category_id, title, slug, excerpt, body, cover_hue, status, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      authorId,
      categoryId,
      input.title,
      newSlug(input.title),
      input.excerpt ?? excerptOf(input.body),
      input.body ?? '',
      input.coverHue ?? Math.floor(Math.random() * 360),
      input.status ?? 'published',
      (input.status ?? 'published') === 'published' ? new Date().toISOString() : null,
    );
    syncTags(lastInsertRowid, input.tags ?? []);
    return getPost(lastInsertRowid);
  });
  return result;
}

export function updatePost(id, authorId, input) {
  const current = get('SELECT * FROM posts WHERE id = ?', id);
  if (!current) return null;
  return tx(() => {
    const status = input.status ?? current.status;
    run(
      `UPDATE posts SET title = ?, slug = ?, excerpt = ?, body = ?, cover_hue = ?, status = ?, updated_at = datetime('now'),
              published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN datetime('now') ELSE published_at END
        WHERE id = ?`,
      input.title ?? current.title,
      input.title ? newSlug(input.title) : current.slug,
      input.excerpt ?? (input.body ? excerptOf(input.body) : current.excerpt),
      input.body ?? current.body,
      input.coverHue ?? current.cover_hue,
      status,
      status,
      id,
    );
    if (input.categoryId !== undefined) run('UPDATE posts SET category_id = ? WHERE id = ?', input.categoryId, id);
    if (input.featured !== undefined) run('UPDATE posts SET featured = ? WHERE id = ?', input.featured ? 1 : 0, id);
    if (input.tags !== undefined) syncTags(id, input.tags);
    return getPost(id);
  });
}

function syncTags(postId, tagNames) {
  run('DELETE FROM post_tags WHERE post_id = ?', postId);
  const names = [...new Set((Array.isArray(tagNames) ? tagNames : String(tagNames).split(/[\s,，]+/)).map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean))];
  for (const name of names.slice(0, 8)) {
    const tag = ensureTag(name);
    run('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)', postId, tag.id);
  }
}

export const deletePost = (id) => run('DELETE FROM posts WHERE id = ?', id).changes > 0;
export const setFeatured = (id, value) => run('UPDATE posts SET featured = ? WHERE id = ?', value ? 1 : 0, id).changes > 0;
export const registerView = (id) => run('UPDATE posts SET views = views + 1 WHERE id = ?', id).changes > 0;

export const featuredPosts = (limit = 3) =>
  all(
    `SELECT ${COLUMNS}, (SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id AND c2.status = 'approved') AS commentCount,
            (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'post' AND r.target_id = p.id) AS likeCount
       FROM posts p JOIN users u ON u.id = p.author_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.status = 'published' AND p.featured = 1 ORDER BY p.published_at DESC LIMIT ?`,
    limit,
  ).map(decorate);

export const countPosts = () => get("SELECT COUNT(*) AS n FROM posts WHERE status = 'published'").n;
export const archiveStats = (authorId) => ({
  posts: get("SELECT COUNT(*) AS n FROM posts WHERE author_id = ? AND status = 'published'", authorId).n,
  drafts: get("SELECT COUNT(*) AS n FROM posts WHERE author_id = ? AND status = 'draft'", authorId).n,
  views: get('SELECT COALESCE(SUM(views), 0) AS n FROM posts WHERE author_id = ?', authorId).n,
  likes: get("SELECT COUNT(*) AS n FROM reactions r JOIN posts p ON p.id = r.target_id WHERE r.target_type = 'post' AND p.author_id = ?", authorId).n,
});

function excerptOf(body, max = 120) {
  const text = String(body || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/* ---------------------------------- 评论 ---------------------------------- */

const COMMENT_COLUMNS = `c.id, c.post_id AS postId, c.parent_id AS parentId, c.guest_name AS guestName,
  c.body, c.status, c.created_at AS createdAt, u.id AS userId, u.nickname, u.username, u.avatar_hue AS avatarHue`;

export function listComments(postId, { includePending = false } = {}) {
  const rows = all(
    `SELECT ${COMMENT_COLUMNS},
       (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'comment' AND r.target_id = c.id) AS likeCount
     FROM comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE c.post_id = ? ${includePending ? '' : "AND c.status = 'approved'"}
     ORDER BY c.created_at`,
    postId,
  );
  return rows.map((row) => ({ ...row, pending: row.status === 'pending', likeCount: row.likeCount ?? 0 }));
}

export function createComment(postId, { authorId = null, guestName = '', body, parentId = null, status = 'approved' }) {
  const nickname = authorId ? get('SELECT nickname FROM users WHERE id = ?', authorId).nickname : guestName;
  const { lastInsertRowid } = run(
    'INSERT INTO comments (post_id, author_id, parent_id, guest_name, body, status) VALUES (?, ?, ?, ?, ?, ?)',
    postId,
    authorId,
    parentId,
    authorId ? '' : guestName,
    body,
    status,
  );
  return get(`SELECT ${COMMENT_COLUMNS} FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.id = ?`, lastInsertRowid);
}

export const updateComment = (id, body) => run('UPDATE comments SET body = ? WHERE id = ?', body, id).changes > 0;
export const deleteComment = (id) => run('DELETE FROM comments WHERE id = ?', id).changes > 0;
export const setCommentStatus = (id, status) => run('UPDATE comments SET status = ? WHERE id = ?', status, id).changes > 0;
export const commentAuthor = (id) => get('SELECT author_id AS authorId FROM comments WHERE id = ?', id);
export const countComments = (status = 'approved') => get('SELECT COUNT(*) AS n FROM comments WHERE status = ?', status).n;
export const pendingComments = (limit = 50) =>
  all(
    `SELECT ${COMMENT_COLUMNS} FROM comments c LEFT JOIN users u ON u.id = c.author_id
      WHERE c.status = 'pending' ORDER BY c.created_at DESC LIMIT ?`,
    limit,
  ).map((row) => ({ ...row, pending: true }));

/* ---------------------------------- 互动 ---------------------------------- */

export function toggleReaction(targetType, targetId, userId) {
  const existing = get('SELECT id FROM reactions WHERE target_type = ? AND target_id = ? AND user_id = ?', targetType, targetId, userId);
  if (existing) {
    run('DELETE FROM reactions WHERE id = ?', existing.id);
    return { liked: false, count: reactionCount(targetType, targetId) };
  }
  run('INSERT INTO reactions (target_type, target_id, user_id) VALUES (?, ?, ?)', targetType, targetId, userId);
  return { liked: true, count: reactionCount(targetType, targetId) };
}

export const reactionCount = (targetType, targetId) =>
  get('SELECT COUNT(*) AS n FROM reactions WHERE target_type = ? AND target_id = ?', targetType, targetId).n;

export function toggleBookmark(postId, userId) {
  const existing = get('SELECT id FROM bookmarks WHERE post_id = ? AND user_id = ?', postId, userId);
  if (existing) {
    run('DELETE FROM bookmarks WHERE id = ?', existing.id);
    return { bookmarked: false };
  }
  run('INSERT INTO bookmarks (post_id, user_id) VALUES (?, ?)', postId, userId);
  return { bookmarked: true };
}

export const listBookmarks = (userId) =>
  all(
    `SELECT ${COLUMNS}, b.created_at AS savedAt
       FROM bookmarks b JOIN posts p ON p.id = b.post_id
       JOIN users u ON u.id = p.author_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE b.user_id = ? AND p.status = 'published' ORDER BY b.id DESC`,
    userId,
  ).map(decorate);

export const bookmarkedIds = (userId) => all('SELECT post_id AS postId FROM bookmarks WHERE user_id = ?', userId).map((row) => row.postId);

/** 个人主页用的公开文章。 */
export const postsByAuthor = (authorId, limit = 20) =>
  listPosts({ authorId, size: limit }).items;
