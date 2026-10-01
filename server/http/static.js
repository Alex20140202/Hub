import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { SECURITY_HEADERS, hstsHeaders } from './respond.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.csv': 'text/csv; charset=utf-8',
};

export function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|wasm|xml)|image\/svg)/;

/**
 * 永不外传的路径。
 * public/ 里出现 .DS_Store、.env、.git* 这类文件通常是误提交或工具生成的，
 * 一旦被静态服务命中就等于把仓库内部信息挂到公网上，直接拒掉。
 * 注意 public/ 根目录下的 .well-known 是合法目录，不在此列。
 */
function isDenied(rel) {
  return rel
    .split('/')
    .some((seg) => seg.startsWith('.') && seg !== '.well-known' && seg !== '..');
}

export function createStaticHandler({ root, urlPrefix = '/uploads/', immutable = true } = {}) {
  const base = path.resolve(root);

  return async function serveStatic(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath);
    if (rel.startsWith(urlPrefix)) rel = rel.slice(urlPrefix.length);
    else rel = rel.replace(/^\/+/, '');

    if (isDenied(rel)) return false;

    const target = path.resolve(base, rel);
    // 目录穿越防护
    if (target !== base && !target.startsWith(base + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return true;
    }

    let stat;
    try {
      stat = await fs.promises.stat(target);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;

    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const type = mimeFor(target);
    const headers = {
      'Content-Type': type,
      'Last-Modified': stat.mtime.toUTCString(),
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    };
    headers['Cache-Control'] = immutable && !/index\.html$/.test(target)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate';

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const accepts = String(req.headers['accept-encoding'] || '');
      const gzip = COMPRESSIBLE.test(type) && /\bgzip\b/.test(accepts) && stat.size > 1024;
      const sendHeaders = { ...headers, ...SECURITY_HEADERS, ...hstsHeaders(req) };
      if (gzip) {
        sendHeaders['Content-Encoding'] = 'gzip';
        sendHeaders.Vary = 'Accept-Encoding';
      } else {
        sendHeaders['Content-Length'] = stat.size;
      }
      res.writeHead(200, sendHeaders);
      if (req.method === 'HEAD') {
        res.end();
        return true;
      }
      const stream = fs.createReadStream(target);
      if (gzip) {
        await pipeline(stream, zlib.createGzip({ level: 6 }), res).catch(() => {});
      } else {
        await pipeline(stream, res).catch(() => {});
      }
      return true;
    }
    return false;
  };
}

export function fileHash(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
