import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const cache = new Map();

/**
 * 静态资源服务。带 ETag / 304 协商，路径穿越一律拒绝。
 * 返回 true 表示已处理该请求。
 */
export function serveStatic(req, res, rootDir, urlPath) {
  const decoded = safeDecode(urlPath);
  if (decoded == null) return false;

  const relative = decoded.replace(/^\/+/, '');
  if (!relative) return false;

  const target = path.resolve(rootDir, relative);
  const root = path.resolve(rootDir);
  if (target !== root && !target.startsWith(root + path.sep)) return false;

  let stats;
  try {
    stats = statSync(target);
  } catch {
    return false;
  }
  if (stats.isDirectory()) return false;

  const ext = path.extname(target).toLowerCase();
  const etag = etagFor(target, stats, ext);

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl(ext) });
    res.end();
    return true;
  }

  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': stats.size,
    ETag: etag,
    'Cache-Control': cacheControl(ext),
    'Last-Modified': stats.mtime.toUTCString(),
  });

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(target).pipe(res);
  return true;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function etagFor(target, stats, ext) {
  if (ext !== '.map') {
    const hit = cache.get(target);
    if (hit && hit.mtime === stats.mtimeMs && hit.size === stats.size) return hit.etag;
  }
  const hash = createHash('sha1')
    .update(`${stats.mtimeMs}:${stats.size}`)
    .digest('base64url')
    .slice(0, 20);
  const etag = `W/"${hash}"`;
  if (ext !== '.map') cache.set(target, { mtime: stats.mtimeMs, size: stats.size, etag });
  return etag;
}

function cacheControl(ext) {
  if (ext === '.html') return 'no-cache';
  return 'public, max-age=0, must-revalidate';
}
