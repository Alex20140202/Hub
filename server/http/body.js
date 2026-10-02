import { badRequest, tooLarge } from '../lib/http-error.js';
import { config } from '../config.js';

/** 收集原始请求体，超过上限立即中断。 */
export function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(tooLarge('请求体超出大小限制'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req) {
  const raw = await readRaw(req, config.maxJsonBytes);
  if (!raw.length) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw badRequest('请求体必须是 JSON 对象');
    }
    return parsed;
  } catch (error) {
    if (error.status) throw error;
    throw badRequest('JSON 解析失败');
  }
}

const DASH = '--';

/** 极简 multipart/form-data 解析：返回 fields 与 files（内存缓冲）。 */
export function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw badRequest('缺少 multipart boundary');
  const boundary = Buffer.from(`--${(match[1] ?? match[2]).trim()}`);
  const fields = Object.create(null);
  const files = [];

  let cursor = buffer.indexOf(boundary);
  if (cursor < 0) throw badRequest('multipart 内容格式错误');
  cursor += boundary.length;

  while (cursor < buffer.length) {
    if (buffer[cursor] === 0x2d && buffer[cursor + 1] === 0x2d) break; // 收尾 "--"
    if (buffer[cursor] === 0x0d) cursor += 2; // 跳过 CRLF

    const headerEnd = buffer.indexOf('\r\n\r\n', cursor, 'utf8');
    if (headerEnd < 0) break;
    const rawHeaders = buffer.subarray(cursor, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;

    let next = buffer.indexOf(boundary, bodyStart);
    if (next < 0) next = buffer.length;
    // 去掉分隔符前的 CRLF
    const body = buffer.subarray(bodyStart, Math.max(bodyStart, next - 2));

    const disposition = /content-disposition:.*/i.exec(rawHeaders)?.[0] ?? '';
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    const filenameStar = /\bfilename\*=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? filenameStar;
    const type = /content-type:\s*([^\r\n]+)/i.exec(rawHeaders)?.[1]?.trim();

    if (name) {
      if (filename !== undefined) {
        if (filename) files.push({ field: name, filename: decodeName(filename), type: type || 'application/octet-stream', data: body });
      } else {
        fields[name] = body.toString('utf8');
      }
    }
    cursor = next + boundary.length;
  }

  return { fields, files };
}

function decodeName(name) {
  // multipart 头按 latin1 读出，中文文件名需重新按 UTF-8 解释
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}

/** 解析 Cookie 头。 */
export function parseCookies(header) {
  const jar = Object.create(null);
  if (!header) return jar;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      jar[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      jar[key] = part.slice(eq + 1).trim();
    }
  }
  return jar;
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  if (options.expires) parts.push(`Expires=${new Date(options.expires).toUTCString()}`);
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  return parts.join('; ');
}
