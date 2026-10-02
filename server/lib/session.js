import { signToken, verifyToken } from './token.js';
import { config } from '../config.js';
import { serializeCookie } from '../http/body.js';

/** 会话 Cookie 名称：双端都可用（前端 fetch 也会带上）。 */
export const COOKIE = 'hub_session';

export function issueToken(payload) {
  return signToken({ ...payload, exp: Date.now() + config.tokenTtlMs });
}

export function readToken(headers, cookies) {
  const header = String(headers.authorization || '');
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return cookies[COOKIE] || null;
}

export function verifySessionToken(token) {
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload?.sid || !payload?.uid) return null;
  return { userId: Number(payload.uid), sessionId: payload.sid };
}

export const sessionCookie = (token) =>
  serializeCookie(COOKIE, token, {
    maxAge: config.tokenTtlMs,
    sameSite: 'Lax',
    secure: config.secureCookies,
  });

export const clearSessionCookie = () => serializeCookie(COOKIE, '', { maxAge: 0, sameSite: 'Lax' });
