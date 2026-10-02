import { all, get, run } from '../db.js';

const COLUMNS = `id, user_id AS userId, title, url, description, tags, starred, clicks, created_at AS createdAt`;

const shape = (row) => (row ? { ...row, starred: Boolean(row.starred), tags: row.tags ? row.tags.split(' ') : [] } : null);

export function listLinks(userId, { q = '', tag = '', starred = false, sort = 'recent' } = {}) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (q) {
    where.push('(title LIKE ? OR url LIKE ? OR description LIKE ? OR tags LIKE ?)');
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    params.push(like, like, like, like);
  }
  if (tag) {
    where.push('(\' \' || tags || \' \') LIKE ?');
    params.push(`% ${tag} %`);
  }
  if (starred) where.push('starred = 1');
  const order = { clicks: 'clicks DESC, created_at DESC', title: 'title COLLATE NOCASE ASC' }[sort] ?? 'starred DESC, created_at DESC';
  return all(`SELECT ${COLUMNS} FROM links WHERE ${where.join(' AND ')} ORDER BY ${order}`, ...params).map(shape);
}

export const getLink = (id, userId) => shape(get(`SELECT ${COLUMNS} FROM links WHERE id = ? AND user_id = ?`, id, userId));

export function createLink(userId, input) {
  const { lastInsertRowid } = run(
    'INSERT INTO links (user_id, title, url, description, tags, starred) VALUES (?, ?, ?, ?, ?, ?)',
    userId,
    input.title,
    input.url,
    input.description ?? '',
    Array.isArray(input.tags) ? input.tags.join(' ') : (input.tags ?? ''),
    input.starred ? 1 : 0,
  );
  return getLink(lastInsertRowid, userId);
}

export function updateLink(id, userId, input) {
  const current = getLink(id, userId);
  if (!current) return null;
  run(
    'UPDATE links SET title = ?, url = ?, description = ?, tags = ?, starred = ? WHERE id = ? AND user_id = ?',
    input.title ?? current.title,
    input.url ?? current.url,
    input.description ?? current.description,
    Array.isArray(input.tags) ? input.tags.join(' ') : (input.tags ?? current.tags.join(' ')),
    input.starred === undefined ? (current.starred ? 1 : 0) : input.starred ? 1 : 0,
    id,
    userId,
  );
  return getLink(id, userId);
}

export const deleteLink = (id, userId) => run('DELETE FROM links WHERE id = ? AND user_id = ?', id, userId).changes > 0;

export const registerClick = (id, userId) => {
  run('UPDATE links SET clicks = clicks + 1 WHERE id = ? AND user_id = ?', id, userId);
  return getLink(id, userId);
};

export const linkStats = (userId) => ({
  total: get('SELECT COUNT(*) AS n FROM links WHERE user_id = ?', userId).n,
  starred: get('SELECT COUNT(*) AS n FROM links WHERE user_id = ? AND starred = 1', userId).n,
  clicks: get('SELECT COALESCE(SUM(clicks), 0) AS n FROM links WHERE user_id = ?', userId).n,
  folders: get("SELECT COUNT(DISTINCT tags) AS n FROM links WHERE user_id = ? AND tags <> ''", userId).n,
});

export const topLinks = (userId, limit = 5) =>
  all(`SELECT ${COLUMNS} FROM links WHERE user_id = ? ORDER BY clicks DESC, id LIMIT ?`, userId, limit).map(shape);

export const allTags = (userId) => {
  const counter = new Map();
  for (const row of all('SELECT tags FROM links WHERE user_id = ?', userId)) {
    for (const tag of row.tags.split(' ').filter(Boolean)) counter.set(tag, (counter.get(tag) ?? 0) + 1);
  }
  return [...counter.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
};
