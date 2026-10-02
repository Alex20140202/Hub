import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');
const sign = (payload, secret) => createHmac('sha256', secret).update(payload).digest('base64url');

/** 签发紧凑令牌：`<payload>.<signature>`，payload 为 base64url JSON。 */
export function signToken(payload) {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body, config.tokenSecret)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.', 2);
  if (!body || !signature) return null;
  const expected = sign(body, config.tokenSecret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp === 'number' && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export const newSessionId = () => randomBytes(18).toString('base64url');

export const newSalt = () => randomBytes(16).toString('hex');
