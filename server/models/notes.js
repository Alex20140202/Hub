import { all, get, run } from '../db.js';

const COLUMNS = `id, user_id AS userId, title, body, tags, color, pinned, created_at AS createdAt, updated_at AS updatedAt`;

const shape = (row) => (row ? { ...row, pinned: Boolean(row.pinned), tags: row.tags ? row.tags.split(' ') : [] } : null);

export function listNotes(userId, { q = '', tag = '', limit = 100, offset = 0 } = {}) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (q) {
    where.push('(title LIKE ? OR body LIKE ? OR tags LIKE ?)');
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    params.push(like, like, like);
  }
  if (tag) {
    where.push('(\' \' || tags || \' \') LIKE ?');
    params.push(`% ${tag} %`);
  }
  const rows = all(
    `SELECT ${COLUMNS} FROM notes WHERE ${where.join(' AND ')} ORDER BY pinned DESC, updated_at DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  const total = get(`SELECT COUNT(*) AS n FROM notes WHERE ${where.join(' AND ')}`, ...params).n;
  return { items: rows.map(shape), total };
}

export const getNote = (id, userId) => shape(get(`SELECT ${COLUMNS} FROM notes WHERE id = ? AND user_id = ?`, id, userId));

const normalizeTags = (value) =>
  (Array.isArray(value) ? value.join(' ') : String(value ?? '')).trim();

export function createNote(userId, input) {
  const { lastInsertRowid } = run(
    'INSERT INTO notes (user_id, title, body, tags, color, pinned) VALUES (?, ?, ?, ?, ?, ?)',
    userId,
    input.title ?? '',
    input.body ?? '',
    normalizeTags(input.tags),
    input.color ?? 'slate',
    input.pinned ? 1 : 0,
  );
  return getNote(lastInsertRowid, userId);
}

export function updateNote(id, userId, input) {
  const current = getNote(id, userId);
  if (!current) return null;
  run(
    "UPDATE notes SET title = ?, body = ?, tags = ?, color = ?, pinned = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    input.title ?? current.title,
    input.body ?? current.body,
    Array.isArray(input.tags) ? input.tags.join(' ') : (input.tags ?? current.tags.join(' ')),
    input.color ?? current.color,
    input.pinned === undefined ? (current.pinned ? 1 : 0) : input.pinned ? 1 : 0,
    id,
    userId,
  );
  return getNote(id, userId);
}

export const deleteNote = (id, userId) => run('DELETE FROM notes WHERE id = ? AND user_id = ?', id, userId).changes > 0;

export const countNotes = (userId) => get('SELECT COUNT(*) AS n FROM notes WHERE user_id = ?', userId).n;
export const recentNotes = (userId, limit = 5) =>
  all(`SELECT ${COLUMNS} FROM notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`, userId, limit).map(shape);
export const noteTags = (userId) => {
  const counter = new Map();
  for (const row of all('SELECT tags FROM notes WHERE user_id = ?', userId)) {
    for (const tag of row.tags.split(' ').filter(Boolean)) counter.set(tag, (counter.get(tag) ?? 0) + 1);
  }
  return [...counter.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
};
