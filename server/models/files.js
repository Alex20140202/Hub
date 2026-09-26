import fs from 'node:fs';
import path from 'node:path';
import { all, get, run } from '../db.js';
import { randomId, nowIso } from '../lib/id.js';
import HttpError from '../lib/http-error.js';
import config from '../config.js';
import { fileHash } from '../http/static.js';

export const FOLDERS = ['image', 'doc', 'archive', 'media', 'misc'];

const EXT_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
  '.zip': 'application/zip', '.gz': 'application/gzip', '.tar': 'application/x-tar',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.csv': 'text/csv',
};

export function guessMime(filename, provided) {
  const ext = path.extname(filename).toLowerCase();
  return provided && provided !== 'application/octet-stream' ? provided : EXT_MIME[ext] || 'application/octet-stream';
}

function safeName(filename) {
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12);
  const base = path
    .basename(filename, path.extname(filename))
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'file';
  return `${base}${ext}`;
}

export function inferFolder(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'media';
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip')) return 'archive';
  if (mime.startsWith('text/') || mime.includes('pdf') || mime.includes('json')) return 'doc';
  return 'misc';
}

function shape(row) {
  return {
    id: row.id,
    filename: row.filename,
    storedName: row.stored_name,
    mime: row.mime,
    size: row.size,
    folder: row.folder,
    description: row.description,
    downloads: row.downloads,
    isPublic: !!row.is_public,
    createdAt: row.created_at,
    url: `/uploads/${row.stored_name}`,
    owner: row.username || null,
    userId: row.user_id || null,
    humanSize: humanSize(row.size),
  };
}

export function humanSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function list(userId, { folder = null, q = '', page = 1, size = 24, isAdmin = false } = {}) {
  const where = [];
  const params = [];
  if (!isAdmin) {
    where.push('(f.is_public = 1 OR f.user_id = ?)');
    params.push(userId || '');
  }
  if (folder) {
    where.push('f.folder = ?');
    params.push(folder);
  }
  if (q) {
    where.push('(f.filename LIKE ? OR f.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) AS c FROM files f ${clause}`, params).c;
  const rows = all(
    `SELECT f.*, u.username FROM files f LEFT JOIN users u ON u.id = f.user_id
     ${clause} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
    [...params, size, (page - 1) * size],
  );
  return { items: rows.map(shape), total, page, size, pages: Math.max(1, Math.ceil(total / size)) };
}

/** 单文件上限 = 基础限制 + 商城扩容（每 MB） */
export function uploadLimitFor(userId) {
  const bonusMb = userId
    ? get('SELECT storage_bonus FROM users WHERE id = ?', [userId])?.storage_bonus || 0
    : 0;
  return config.limits.uploadBytes + bonusMb * 1024 * 1024;
}

export function usage() {
  const rows = all('SELECT folder, COUNT(*) AS c, SUM(size) AS bytes FROM files GROUP BY folder');
  const total = rows.reduce((sum, r) => sum + (r.bytes || 0), 0);
  return { total, byFolder: rows.map((r) => ({ folder: r.folder, count: r.c, bytes: r.bytes, human: humanSize(r.bytes || 0) })) };
}

export async function store({ file, userId = null, folder = null, description = '', isPublic = true }) {
  if (!file || !file.data?.length) throw HttpError.badRequest('没有收到文件');
  const limit = uploadLimitFor(userId);
  if (file.size > limit) throw HttpError.tooLarge(`文件超过 ${humanSize(limit)} 限制`);
  const mime = guessMime(file.filename, file.contentType);
  const stored = `${Date.now().toString(36)}-${randomId(6)}-${safeName(file.filename)}`;
  const target = path.join(config.paths.uploads, stored);
  await fs.promises.writeFile(target, file.data);

  const id = randomId(10);
  run(
    `INSERT INTO files (id, user_id, filename, stored_name, mime, size, folder, description, downloads, is_public, created_at)
     VALUES (?,?,?,?,?,?,?,?,0,?,?)`,
    [id, userId, file.filename, stored, mime, file.size, folder || inferFolder(mime), description, isPublic ? 1 : 0, nowIso()],
  );
  return shape(get('SELECT * FROM files WHERE id = ?', [id]));
}

export function find(id) {
  const row = get(
    'SELECT f.*, u.username FROM files f LEFT JOIN users u ON u.id = f.user_id WHERE f.id = ?',
    [id],
  );
  if (!row) throw HttpError.notFound('文件不存在');
  return shape(row);
}

export function update(id, patch) {
  const row = get('SELECT * FROM files WHERE id = ?', [id]);
  if (!row) throw HttpError.notFound('文件不存在');
  run('UPDATE files SET description = ?, folder = ?, is_public = ? WHERE id = ?', [
    patch.description === undefined ? row.description : patch.description,
    patch.folder ?? row.folder,
    patch.isPublic === undefined ? row.is_public : patch.isPublic ? 1 : 0,
    id,
  ]);
  return shape(get('SELECT * FROM files WHERE id = ?', [id]));
}

export async function remove(id) {
  const row = get('SELECT * FROM files WHERE id = ?', [id]);
  if (!row) throw HttpError.notFound('文件不存在');
  const target = path.join(config.paths.uploads, path.basename(row.stored_name));
  await fs.promises.rm(target, { force: true });
  run('DELETE FROM files WHERE id = ?', [id]);
  return true;
}

export function countDownload(id) {
  run('UPDATE files SET downloads = downloads + 1 WHERE id = ?', [id]);
  return get('SELECT downloads FROM files WHERE id = ?', [id])?.downloads ?? 0;
}

export { fileHash, FOLDERS as folders };
