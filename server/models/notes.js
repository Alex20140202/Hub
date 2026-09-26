import { all, get, run } from '../db.js';
import { randomId, nowIso } from '../lib/id.js';
import HttpError from '../lib/http-error.js';

function parseTags(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.slice(0, 10) : [];
  } catch {
    return [];
  }
}

function shape(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    color: row.color,
    pinned: !!row.pinned,
    archived: !!row.archived,
    tags: parseTags(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function list(userId, { q = '', archived = false, color = null } = {}) {
  const where = ['user_id = ?'];
  const params = [userId];
  where.push('archived = ?');
  params.push(archived ? 1 : 0);
  if (q) {
    where.push('(title LIKE ? OR content LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (color) {
    where.push('color = ?');
    params.push(color);
  }
  return all(
    `SELECT * FROM notes WHERE ${where.join(' AND ')} ORDER BY pinned DESC, updated_at DESC`,
    params,
  ).map(shape);
}

export function find(id, userId) {
  const row = get('SELECT * FROM notes WHERE id = ? AND user_id = ?', [id, userId]);
  if (!row) throw HttpError.notFound('笔记不存在');
  return shape(row);
}

export function create(userId, { title, content = '', color = 'default', pinned = false, tags = [] }) {
  const id = randomId(10);
  const now = nowIso();
  run(
    `INSERT INTO notes (id, user_id, title, content, color, pinned, archived, tags, created_at, updated_at)
     VALUES (?,?,?,?,?,?,0,?,?,?)`,
    [id, userId, title, content, color, pinned ? 1 : 0, JSON.stringify(tags), now, now],
  );
  return shape(get('SELECT * FROM notes WHERE id = ?', [id]));
}

export function update(id, userId, patch) {
  const note = get('SELECT * FROM notes WHERE id = ? AND user_id = ?', [id, userId]);
  if (!note) throw HttpError.notFound('笔记不存在');
  run(
    `UPDATE notes SET title=?, content=?, color=?, pinned=?, archived=?, tags=?, updated_at=? WHERE id = ?`,
    [
      patch.title ?? note.title,
      patch.content ?? note.content,
      patch.color ?? note.color,
      patch.pinned === undefined ? note.pinned : patch.pinned ? 1 : 0,
      patch.archived === undefined ? note.archived : patch.archived ? 1 : 0,
      patch.tags ? JSON.stringify(patch.tags) : note.tags,
      nowIso(),
      id,
    ],
  );
  return shape(get('SELECT * FROM notes WHERE id = ?', [id]));
}

export function remove(id, userId) {
  const note = get('SELECT id FROM notes WHERE id = ? AND user_id = ?', [id, userId]);
  if (!note) throw HttpError.notFound('笔记不存在');
  run('DELETE FROM notes WHERE id = ?', [id]);
  return true;
}

export function colors() {
  return all(
    `SELECT color, COUNT(*) AS c FROM notes GROUP BY color ORDER BY c DESC`,
  );
}
