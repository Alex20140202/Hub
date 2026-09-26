import * as shorts from '../models/shorts.js';

const KNOWN_ROUTES = new Set([
  '/', '/login', '/register', '/logout', '/about', '/help',
  '/dashboard', '/blog', '/notes', '/todos', '/links', '/files', '/chat',
  '/short', '/profile', '/search', '/admin', '/settings', '/uploads',
  '/editor', '/post', '/new',
]);

/** 命中短链则返回目标地址，否则返回 null */
export async function resolveShort(pathname) {
  if (KNOWN_ROUTES.has(pathname)) return null;
  const code = pathname.replace(/^\//, '');
  if (!code || code.includes('/') || code.length > 32) return null;
  if (!/^[\w-]+$/.test(code)) return null;
  const row = shorts.findByCode(code);
  if (!row || row.active === false || row.active === 0) return null;
  try {
    shorts.resolve(code);
    return row;
  } catch {
    return row;
  }
}
