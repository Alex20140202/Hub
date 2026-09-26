import { all, get, run } from '../db.js';
import { randomId, nowIso } from '../lib/id.js';
import HttpError from '../lib/http-error.js';
import { fileHash } from '../http/static.js';

function parseTags(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function shape(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    note: row.note,
    tags: parseTags(row.tags),
    category: row.category,
    favicon: row.favicon || faviconFor(row.url),
    clicks: row.clicks,
    starred: !!row.starred,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function faviconFor(url) {
  try {
    const u = new URL(url);
    return `${u.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

export function list(userId, { q = '', category = null, starred = false, sort = 'new' } = {}) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (q) {
    where.push('(title LIKE ? OR url LIKE ? OR note LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  if (starred) where.push('starred = 1');
  const order = { new: 'created_at DESC', clicks: 'clicks DESC', title: 'title ASC' }[sort] || 'created_at DESC';
  const rows = all(`SELECT * FROM links WHERE ${where.join(' AND ')} ORDER BY ${order}`, params);
  const items = rows.map(shape);
  const grouped = {};
  for (const item of items) {
    (grouped[item.category] ||= []).push(item);
  }
  return { items, grouped, total: items.length };
}

export function categoriesOf(userId) {
  return all(
    'SELECT category, COUNT(*) AS c FROM links WHERE user_id = ? GROUP BY category ORDER BY c DESC',
    [userId],
  );
}

export function create(userId, { title, url, note = '', tags = [], category = 'general', starred = false }) {
  const id = randomId(10);
  run(
    `INSERT INTO links (id, user_id, title, url, note, tags, category, clicks, starred, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,0,?,?,?)`,
    [id, userId, title, url, note, JSON.stringify(tags), category, starred ? 1 : 0, nowIso(), nowIso()],
  );
  return shape(get('SELECT * FROM links WHERE id = ?', [id]));
}

export function find(id, userId) {
  const row = get('SELECT * FROM links WHERE id = ? AND user_id = ?', [id, userId]);
  if (!row) throw HttpError.notFound('书签不存在');
  return shape(row);
}

export function update(id, userId, patch) {
  const link = get('SELECT * FROM links WHERE id = ? AND user_id = ?', [id, userId]);
  if (!link) throw HttpError.notFound('书签不存在');
  run(
    `UPDATE links SET title=?, url=?, note=?, tags=?, category=?, starred=?, updated_at=? WHERE id = ?`,
    [
      patch.title ?? link.title,
      patch.url ?? link.url,
      patch.note === undefined ? link.note : patch.note,
      patch.tags ? JSON.stringify(patch.tags) : link.tags,
      patch.category ?? link.category,
      patch.starred === undefined ? link.starred : patch.starred ? 1 : 0,
      nowIso(),
      id,
    ],
  );
  return shape(get('SELECT * FROM links WHERE id = ?', [id]));
}

export function remove(id, userId) {
  const link = get('SELECT id FROM links WHERE id = ? AND user_id = ?', [id, userId]);
  if (!link) throw HttpError.notFound('书签不存在');
  run('DELETE FROM links WHERE id = ?', [id]);
  return true;
}

export function trackClick(id) {
  run('UPDATE links SET clicks = clicks + 1 WHERE id = ?', [id]);
  return get('SELECT clicks FROM links WHERE id = ?', [id])?.clicks ?? 0;
}

export { fileHash };
