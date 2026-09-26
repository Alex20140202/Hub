import { all, get, run } from '../db.js';
import { randomId, shortCode, nowIso } from '../lib/id.js';
import HttpError from '../lib/http-error.js';

const RESERVED = new Set([
  'api', 'admin', 'assets', 'static', 'public', 'uploads', 's', 'app', 'login', 'register',
  'logout', 'dashboard', 'blog', 'notes', 'todos', 'links', 'files', 'chat', 'profile',
  'search', 'new', 'edit', 'settings', 'about', 'help', 'favicon.ico', 'robots.txt',
]);

function shape(row) {
  return {
    id: row.id,
    code: row.code,
    shortUrl: `/${row.code}`,
    target: row.target,
    title: row.title,
    clicks: row.clicks,
    active: !!row.active,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    owner: row.username || null,
  };
}

export function list(userId, { limit = 100 } = {}) {
  const rows = all(
    `SELECT s.*, u.username FROM short_links s LEFT JOIN users u ON u.id = s.user_id
     ${userId ? 'WHERE s.user_id = ?' : ''}
     ORDER BY s.created_at DESC LIMIT ?`,
    userId ? [userId, limit] : [limit],
  );
  return rows.map(shape);
}

export function findByCode(code) {
  return get('SELECT * FROM short_links WHERE code = ?', [code]);
}

export function resolve(code) {
  const row = findByCode(code);
  if (!row) throw HttpError.notFound('短链不存在或已失效');
  if (!row.active) throw HttpError.notFound('短链已停用');
  if (row.expires_at && new Date(row.expires_at) < new Date()) throw HttpError.notFound('短链已过期');
  run('UPDATE short_links SET clicks = clicks + 1 WHERE id = ?', [row.id]);
  return row;
}

export function create({ target, title = null, userId = null, custom = null, expiresAt = null }) {
  let code = custom ? String(custom).trim() : shortCode(7);
  if (RESERVED.has(code.toLowerCase())) throw HttpError.badRequest('该短码为系统保留字，请换一个');
  if (!/^[\w-]{3,32}$/.test(code)) throw HttpError.badRequest('短码只能包含字母数字下划线连字符，长度 3-32');
  if (findByCode(code)) throw HttpError.conflict('短码已存在');

  const id = randomId(10);
  run(
    'INSERT INTO short_links (id, code, target, title, user_id, clicks, active, created_at, expires_at) VALUES (?,?,?,?,?,0,1,?,?)',
    [id, code, target, title, userId, nowIso(), expiresAt],
  );
  return shape(get('SELECT * FROM short_links WHERE id = ?', [id]));
}

export function update(id, userId, patch, isAdmin = false) {
  const row = get('SELECT * FROM short_links WHERE id = ?', [id]);
  if (!row) throw HttpError.notFound('短链不存在');
  if (!isAdmin && row.user_id !== userId) throw HttpError.forbidden('无权修改该短链');
  run('UPDATE short_links SET title = ?, active = ?, expires_at = ? WHERE id = ?', [
    patch.title === undefined ? row.title : patch.title,
    patch.active === undefined ? row.active : patch.active ? 1 : 0,
    patch.expiresAt === undefined ? row.expires_at : patch.expiresAt,
    id,
  ]);
  return shape(get('SELECT * FROM short_links WHERE id = ?', [id]));
}

export function remove(id, userId, isAdmin = false) {
  const row = get('SELECT * FROM short_links WHERE id = ?', [id]);
  if (!row) throw HttpError.notFound('短链不存在');
  if (!isAdmin && row.user_id !== userId) throw HttpError.forbidden('无权删除该短链');
  run('DELETE FROM short_links WHERE id = ?', [id]);
  return true;
}

export function topClocks(limit = 5) {
  return all(
    'SELECT code, title, target, clicks FROM short_links WHERE active = 1 ORDER BY clicks DESC LIMIT ?',
    [limit],
  );
}
