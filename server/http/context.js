import { readJson, readRaw, parseMultipart } from './body.js';
import { config } from '../config.js';
import { badRequest, unsupportedMedia } from '../lib/http-error.js';

export { unsupportedMedia };

/**
 * 按 Content-Type 解析请求体：
 * - application/json → 对象
 * - multipart/form-data → { fields, files }
 * - 其它 → 原始文本
 */
export async function readBody(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') return {};

  if (type === 'application/json' || type === 'text/json' || !type) {
    if (!type) return {};
    return readJson(req);
  }

  if (type === 'multipart/form-data') {
    const raw = await readRaw(req, config.maxUploadBytes);
    return parseMultipart(raw, req.headers['content-type']);
  }

  if (type === 'application/x-www-form-urlencoded') {
    const raw = await readRaw(req, config.maxJsonBytes);
    return Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
  }

  throw unsupportedMedia(`不支持的请求类型：${type}`);
}

/** 从 URL 中取出查询参数并做空值归一化。 */
export function readQuery(url) {
  const query = {};
  for (const [key, value] of url.searchParams) query[key] = value;
  return query;
}

export function requireFields(input, fields) {
  for (const field of fields) {
    if (input[field] === undefined) throw badRequest(`缺少字段 ${field}`);
  }
  return input;
}
