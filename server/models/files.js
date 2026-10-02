import { all, get, run } from '../db.js';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { notFound } from '../lib/http-error.js';

const COLUMNS = `id, user_id AS userId, name, stored_name AS storedName, mime, size, folder, is_public AS isPublic, downloads, created_at AS createdAt`;

const shape = (row) => (row ? { ...row, isPublic: Boolean(row.isPublic) } : null);

/** 防目录穿越：只允许落在上传目录内的文件名。 */
export function resolveStoredPath(storedName) {
  const safe = path.basename(String(storedName));
  const target = path.resolve(config.uploadDir, safe);
  if (path.dirname(target) !== path.resolve(config.uploadDir)) throw notFound('文件不存在');
  return target;
}

export function listFiles(userId, { q = '', folder = '' } = {}) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (folder) {
    where.push('folder = ?');
    params.push(folder);
  }
  if (q) {
    where.push('(name LIKE ? OR folder LIKE ?)');
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    params.push(like, like);
  }
  return all(`SELECT ${COLUMNS} FROM files WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, ...params).map(shape);
}

export const getFile = (id, userId) => shape(get(`SELECT ${COLUMNS} FROM files WHERE id = ? AND user_id = ?`, id, userId));

export const createFile = (userId, { name, storedName, mime, size, folder, isPublic }) => {
  const { lastInsertRowid } = run(
    'INSERT INTO files (user_id, name, stored_name, mime, size, folder, is_public) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId,
    name,
    storedName,
    mime,
    size,
    folder,
    isPublic ? 1 : 0,
  );
  return getFile(lastInsertRowid, userId);
};

export const updateFile = (id, userId, input) => {
  const current = getFile(id, userId);
  if (!current) return null;
  run(
    'UPDATE files SET name = ?, folder = ?, is_public = ? WHERE id = ? AND user_id = ?',
    input.name ?? current.name,
    input.folder ?? current.folder,
    input.isPublic === undefined ? (current.isPublic ? 1 : 0) : input.isPublic ? 1 : 0,
    id,
    userId,
  );
  return getFile(id, userId);
};

export async function deleteFile(id, userId) {
  const file = getFile(id, userId);
  if (!file) return false;
  run('DELETE FROM files WHERE id = ? AND user_id = ?', id, userId);
  await unlink(resolveStoredPath(file.storedName)).catch(() => {});
  return true;
}

/** 公开分享视图：只暴露已标记公开的文件。 */
export const getPublicFile = (id) =>
  shape(get(`SELECT ${COLUMNS} FROM files WHERE id = ? AND is_public = 1`, id));

export const registerDownload = (id) => run('UPDATE files SET downloads = downloads + 1 WHERE id = ?', id).changes > 0;

export const storageStats = (userId) => ({
  used: get('SELECT COALESCE(SUM(size), 0) AS n FROM files WHERE user_id = ?', userId).n,
  count: get('SELECT COUNT(*) AS n FROM files WHERE user_id = ?', userId).n,
  folders: all(
    'SELECT folder, COUNT(*) AS count, COALESCE(SUM(size), 0) AS size FROM files WHERE user_id = ? GROUP BY folder ORDER BY size DESC',
    userId,
  ),
});
