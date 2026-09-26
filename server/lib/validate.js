import HttpError from './http-error.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

export function str(value, field, { min = 0, max = 10000, trim = true, required = true } = {}) {
  let v = value === undefined || value === null ? '' : String(value);
  if (trim) v = v.trim();
  if (!v) {
    if (required) throw HttpError.badRequest(`${field}不能为空`);
    return '';
  }
  if (v.length < min) throw HttpError.badRequest(`${field}至少需要 ${min} 个字符`);
  if (v.length > max) throw HttpError.badRequest(`${field}最多 ${max} 个字符`);
  return v;
}

export function email(value, field = '邮箱') {
  const v = str(value, field, { max: 200 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw HttpError.badRequest(`${field}格式不正确`);
  return v;
}

export function url(value, field = '链接', { required = true, allowed = URL_RE } = {}) {
  const v = str(value, field, { required, max: 2000 });
  if (!v) return '';
  if (!allowed.test(v)) throw HttpError.badRequest(`${field}必须以 http:// 或 https:// 开头`);
  return v;
}

export function int(value, field, { min = -Infinity, max = Infinity, fallback } = {}) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw HttpError.badRequest(`${field}必须是数字`);
  const i = Math.trunc(n);
  if (i < min) throw HttpError.badRequest(`${field}不能小于 ${min}`);
  if (i > max) throw HttpError.badRequest(`${field}不能大于 ${max}`);
  return i;
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function oneOf(value, field, options, fallback) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  if (!options.includes(value)) {
    throw HttpError.badRequest(`${field}只能是：${options.join(' / ')}`);
  }
  return value;
}

export function list(value, field, { max = 50, maxItem = 200 } = {}) {
  let arr = value;
  if (typeof arr === 'string') {
    arr = arr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(arr)) return [];
  if (arr.length > max) throw HttpError.badRequest(`${field}最多 ${max} 项`);
  return arr
    .map((item) => String(item).trim().slice(0, maxItem))
    .filter(Boolean);
}

export function username(value) {
  const v = str(value, '用户名', { min: 3, max: 24 });
  if (!/^[\w\u4e00-\u9fa5-]+$/.test(v)) {
    throw HttpError.badRequest('用户名只能包含字母、数字、下划线、连字符或中文');
  }
  return v;
}
