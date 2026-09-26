import { all, get, run } from '../db.js';
import { randomId, nowIso } from '../lib/id.js';
import HttpError from '../lib/http-error.js';

function shape(row) {
  return {
    id: row.id,
    body: row.body,
    status: row.status,
    likes: row.likes,
    createdAt: row.created_at,
    parentId: row.parent_id,
    guestName: row.guest_name,
    author: row.author_id
      ? { id: row.author_id, username: row.username, nickname: row.nickname, avatarColor: row.avatar_color, role: row.role }
      : { id: null, username: null, nickname: row.guest_name || '匿名', avatarColor: '#94a3b8' },
  };
}

const SELECT = `
  SELECT c.*, u.username, u.nickname, u.avatar_color, u.role
  FROM comments c LEFT JOIN users u ON u.id = c.author_id
`;

export function listByPost(postId, { status = 'published' } = {}) {
  const rows = all(`${SELECT} WHERE c.post_id = ? AND c.status = ? ORDER BY c.created_at ASC`, [postId, status]);
  return buildTree(rows);
}

function buildTree(rows) {
  const byId = new Map(rows.map((r) => [r.id, { ...shape(r), replies: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).replies.push(node);
    else roots.push(node);
  }
  return roots;
}

export function recent({ limit = 10, status = 'published' } = {}) {
  return all(
    `SELECT c.id, c.body, c.created_at, p.id AS post_id, p.title AS post_title, p.slug AS post_slug,
            u.username, u.nickname, u.avatar_color
     FROM comments c
     JOIN posts p ON p.id = c.post_id
     LEFT JOIN users u ON u.id = c.author_id
     WHERE c.status = ? ORDER BY c.created_at DESC LIMIT ?`,
    [status, limit],
  ).map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.created_at,
    author: { username: r.username, nickname: r.nickname, avatarColor: r.avatar_color },
    post: { id: r.post_id, title: r.post_title, slug: r.post_slug },
  }));
}

export function countForPost(postId) {
  return get("SELECT COUNT(*) AS c FROM comments WHERE post_id = ? AND status='published'", [postId]).c;
}

export function create({ postId, authorId = null, guestName = null, body, parentId = null, ipHash = null, status = 'published' }) {
  const post = get('SELECT id FROM posts WHERE id = ?', [postId]);
  if (!post) throw HttpError.notFound('文章不存在');
  if (parentId) {
    const parent = get('SELECT id FROM comments WHERE id = ? AND post_id = ?', [parentId, postId]);
    if (!parent) throw HttpError.badRequest('被回复的评论不存在');
  }
  if (!authorId) status = 'pending';

  const id = randomId(10);
  run(
    `INSERT INTO comments (id, post_id, author_id, parent_id, body, guest_name, ip_hash, status, likes, created_at)
     VALUES (?,?,?,?,?,?,?,?,0,?)`,
    [id, postId, authorId, parentId, body, guestName, ipHash, status, nowIso()],
  );
  return shape(get(`${SELECT} WHERE c.id = ?`, [id]));
}

export function update(id, body, { authorId, isAdmin = false } = {}) {
  const row = get('SELECT * FROM comments WHERE id = ?', [id]);
  if (!row) throw HttpError.notFound('评论不存在');
  if (!isAdmin && row.author_id !== authorId) throw HttpError.forbidden('只能编辑自己的评论');
  run('UPDATE comments SET body = ? WHERE id = ?', [body, id]);
  return shape(get(`${SELECT} WHERE c.id = ?`, [id]));
}

export function remove(id, { authorId, isAdmin = false, postAuthorId = null }) {
  const row = get('SELECT * FROM comments WHERE id = ?', [id]);
  if (!row) throw HttpError.notFound('评论不存在');
  const allowed = isAdmin || postAuthorId === authorId || row.author_id === authorId;
  if (!allowed) throw HttpError.forbidden('没有权限删除该评论');
  run('DELETE FROM comments WHERE id = ?', [id]);
  return true;
}

export function setStatus(id, status) {
  run('UPDATE comments SET status = ? WHERE id = ?', [status, id]);
  return true;
}

export function like(id) {
  run('UPDATE comments SET likes = likes + 1 WHERE id = ?', [id]);
  return get('SELECT likes FROM comments WHERE id = ?', [id]).likes;
}

export function pendingCount() {
  return get("SELECT COUNT(*) AS c FROM comments WHERE status='pending'").c;
}

export function shapeById(id) {
  const row = get(`${SELECT} WHERE c.id = ?`, [id]);
  return row ? shape(row) : null;
}

export { shape as shapeComment };
