import crypto from 'node:crypto';
import config from '../config.js';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** HS256 JWT，无外部依赖 */
export function sign(payload, { ttlSec = config.auth.tokenTtlSec } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${header}.${b64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac('sha256', config.auth.secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verify(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac('sha256', config.auth.secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.exp === 'number' && parsed.exp < Math.floor(Date.now() / 1000)) return null;
  return parsed;
}
