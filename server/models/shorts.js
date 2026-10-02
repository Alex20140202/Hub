import { all, get, run } from '../db.js';
import { randomId } from '../lib/slug.js';

const COLUMNS = `id, user_id AS userId, code, target_url AS targetUrl, title, clicks, active, created_at AS createdAt`;

const shape = (row) => (row ? { ...row, active: Boolean(row.active) } : row);

export function listShorts(userId) {
  return all(`SELECT ${COLUMNS} FROM short_links WHERE user_id = ? ORDER BY created_at DESC`, userId).map(shape);
}

/** 创建短链，code 可自定义；冲突时自动追加随机后缀。 */
export function createShort(userId, { code, targetUrl, title = '' }) {
  const finalCode = resolveCode(code);
  const { lastInsertRowid } = run(
    'INSERT INTO short_links (user_id, code, target_url, title) VALUES (?, ?, ?, ?)',
    userId,
    finalCode,
    targetUrl,
    title,
  );
  return shape(get(`SELECT ${COLUMNS} FROM short_links WHERE id = ?`, lastInsertRowid));
}

function resolveCode(requested) {
  const clean = String(requested || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);
  if (!clean) return uniqueCode();
  if (!get('SELECT 1 AS x FROM short_links WHERE code = ?', clean)) return clean;
  for (let i = 0; i < 6; i += 1) {
    const candidate = `${clean}${randomId(2)}`;
    if (!get('SELECT 1 AS x FROM short_links WHERE code = ?', candidate)) return candidate;
  }
  return uniqueCode();
}

function uniqueCode() {
  for (let i = 0; i < 12; i += 1) {
    const code = randomId(6);
    if (!get('SELECT 1 AS x FROM short_links WHERE code = ?', code)) return code;
  }
  throw new Error('短码生成失败，请重试');
}

export const getShort = (id, userId) => shape(get(`SELECT ${COLUMNS} FROM short_links WHERE id = ? AND user_id = ?`, id, userId));

/** 短链跳转：找到启用中的记录并计数。 */
export const resolveRedirect = (code) => {
  const row = get('SELECT id, target_url AS targetUrl, title FROM short_links WHERE code = ? AND active = 1', code);
  if (!row) return null;
  run('UPDATE short_links SET clicks = clicks + 1 WHERE id = ?', row.id);
  return row;
};

export const setActive = (id, userId, value) =>
  run('UPDATE short_links SET active = ? WHERE id = ? AND user_id = ?', value ? 1 : 0, id, userId).changes > 0;

export const deleteShort = (id, userId) => run('DELETE FROM short_links WHERE id = ? AND user_id = ?', id, userId).changes > 0;

export const shortStats = (userId) => ({
  total: get('SELECT COUNT(*) AS n FROM short_links WHERE user_id = ?', userId).n,
  active: get('SELECT COUNT(*) AS n FROM short_links WHERE user_id = ? AND active = 1', userId).n,
  clicks: get('SELECT COALESCE(SUM(clicks), 0) AS n FROM short_links WHERE user_id = ?', userId).n,
});

export const allShorts = (limit = 100) =>
  all(
    `SELECT s.id, s.user_id AS userId, s.code, s.target_url AS targetUrl, s.title,
            s.clicks, s.active, s.created_at AS createdAt, u.nickname AS ownerName
       FROM short_links s JOIN users u ON u.id = s.user_id
      ORDER BY s.id DESC LIMIT ?`,
    limit,
  ).map(shape);

export const topShorts = (userId, limit = 5) =>
  all(`SELECT ${COLUMNS} FROM short_links WHERE user_id = ? ORDER BY clicks DESC LIMIT ?`, userId, limit).map(shape);
