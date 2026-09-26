import HttpError from '../lib/http-error.js';
import config from '../config.js';

function parseCookiesSafe(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    try {
      out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** 收集原始请求体，带体积上限 */
export function readRaw(req, limit = config.limits.bodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      fn(arg);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        finish(reject, HttpError.tooLarge(`请求体超过 ${Math.floor(limit / 1024)}KB 限制`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(resolve, Buffer.concat(chunks)));
    req.on('error', (err) => finish(reject, err));
    req.on('aborted', () => finish(reject, HttpError.badRequest('请求被中断')));
  });
}

async function parseUrlEncoded(text) {
  const params = new URLSearchParams(text);
  const out = {};
  for (const [k, v] of params) {
    if (k in out) out[k] = Array.isArray(out[k]) ? [...out[k], v] : [out[k], v];
    else out[k] = v;
  }
  return out;
}

/** 读取请求体 → { body, files }，自动识别 JSON / 表单 / multipart */
export async function readBody(req) {
  const raw = await readRaw(req);
  if (raw.length === 0) return { body: {}, files: {} };

  const type = (req.headers['content-type'] || '').toLowerCase();
  if (type.includes('application/json')) {
    try {
      return { body: JSON.parse(raw.toString('utf8')) ?? {}, files: {} };
    } catch {
      throw HttpError.badRequest('JSON 格式有误');
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    return { body: await parseUrlEncoded(raw.toString('utf8')), files: {} };
  }
  if (type.includes('multipart/form-data')) {
    const { parseMultipart } = await import('./multipart.js');
    return parseMultipart(raw, req.headers['content-type']);
  }
  // 兜底：尝试 JSON
  try {
    return { body: JSON.parse(raw.toString('utf8')) ?? {}, files: {} };
  } catch {
    return { body: {}, files: {} };
  }
}

export function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export { parseCookiesSafe };
