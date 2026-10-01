import config from '../config.js';

/*
 * 内容安全策略。
 *
 * 说明每一项为什么这么写，避免以后被「看起来可以收紧」的心态误删：
 *  - script-src 'self'：应用没有内联脚本，也不需要 eval/new Function。
 *    原本防闪烁的内联脚本已抽到 /js/theme-boot.js。
 *  - style-src 含 'unsafe-inline'：视图层有 300 处 style="..." 行内样式
 *    （el() 的 style 属性直接落到 DOM 上），短期无法移除。
 *    要去掉需要把所有行内样式抽成 class，属于独立的重构。
 *  - img-src 允许 data:/blob:：头像与上传预览可能用到。
 *  - connect-src 'self'：聊天 WebSocket 是同源 ws://，'self' 已覆盖。
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-DNS-Prefetch-Control': 'off',
  'Content-Security-Policy': CSP,
  // 本站用不到摄像头/麦克风/定位等能力，显式关掉，减少被第三方脚本借用的面
  'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
};

/**
 * Strict-Transport-Security 只在 HTTPS 下才有意义：
 * 浏览器按规范会忽略通过 HTTP 收到的 HSTS 头，无条件下发纯属自我安慰，
 * 反而容易让人误以为已启用。所以这里按实际传输协议决定。
 */
export function isSecureRequest(req) {
  if (req.socket?.encrypted) return true;
  // 部署在 TLS 反向代理后面时由代理补这个头
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
}

export function hstsHeaders(req) {
  if (!isSecureRequest(req)) return {};
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}

export function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(body);
}

export function sendText(res, status, text, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(text);
}

export function sendHtml(res, status, html, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(html);
}

export function sendEmpty(res, status = 204, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end();
}

export function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, ...SECURITY_HEADERS });
  res.end();
}

export function setCookie(res, name, value, { maxAge, expires, httpOnly = true, sameSite = 'Lax', path: p = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${p}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (config.isProd) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (expires) parts.push(`Expires=${new Date(expires).toUTCString()}`);
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  list.push(parts.join('; '));
  res.setHeader('Set-Cookie', list);
}

export function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[k] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

export { SECURITY_HEADERS };
