import { badRequest } from './http-error.js';
import { run } from '../db.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[a-z0-9_](?:[a-z0-9_-]{1,22})[a-z0-9_]$/i;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export const isEmail = (value) => EMAIL_RE.test(String(value || '').trim());
export const isUsername = (value) => USERNAME_RE.test(String(value || '').trim());

export function str(value, field, { min = 0, max = 500, trim = true, required = true, fallback = '' } = {}) {
  let text = value == null ? '' : String(value);
  if (trim) text = text.trim();
  if (!text) {
    if (required) throw badRequest(`${field}不能为空`);
    return fallback;
  }
  if (text.length < min) throw badRequest(`${field}至少 ${min} 个字符`);
  if (text.length > max) throw badRequest(`${field}最多 ${max} 个字符`);
  return text;
}

export function oneOf(value, field, allowed, fallback = allowed[0]) {
  const text = String(value ?? fallback);
  if (!allowed.includes(text)) throw badRequest(`${field}取值不合法`);
  return text;
}

export function int(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) throw badRequest(`${field}必须是数字`);
  if (parsed < min || parsed > max) throw badRequest(`${field}超出允许范围`);
  return parsed;
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase());
}

export function dateOrNull(value, field) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?/.test(text)) throw badRequest(`${field}日期格式不合法`);
  const normalized = text.length === 10 ? `${text} 23:59` : text.replace('T', ' ');
  return Number.isNaN(Date.parse(normalized.replace(' ', 'T'))) ? null : normalized;
}

export function accent(value, field = '主题色') {
  const text = str(value, field, { max: 32, required: false, fallback: 'indigo' });
  if (text.startsWith('#')) {
    if (!HEX_COLOR_RE.test(text)) throw badRequest(`${field}需为 #RRGGBB 格式`);
    return text.toLowerCase();
  }
  return oneOf(text, field, ACCENTS);
}

export const ACCENTS = ['indigo', 'emerald', 'amber', 'rose', 'cyan', 'violet'];
export const THEMES = ['light', 'dark', 'auto'];
export const PRIORITIES = ['low', 'normal', 'high'];
export const NOTE_COLORS = ['slate', 'indigo', 'emerald', 'amber', 'rose', 'cyan'];

export function email(value, field = '邮箱') {
  const text = str(value, field, { max: 254, required: false, fallback: '' }).toLowerCase();
  if (!text) return '';
  if (!isEmail(text)) throw badRequest('邮箱格式不正确');
  return text;
}

export function username(value, field = '用户名') {
  const text = str(value, field, { min: 3, max: 24 });
  if (!isUsername(text)) throw badRequest('用户名为 3-24 位字母、数字、下划线或连字符');
  return text;
}

export function password(value, field = '密码') {
  const text = String(value ?? '');
  if (text.length < 8) throw badRequest('密码至少 8 个字符');
  if (text.length > 200) throw badRequest('密码过长');
  return text;
}

export function url(value, field = '链接') {
  const text = str(value, field, { max: 2000 });
  let parsed;
  try {
    parsed = new URL(/^[a-z][\w+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    throw badRequest(`${field}不是合法的网址`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw badRequest(`${field}只支持 http 或 https`);
  return parsed.toString();
}

export function tags(value, field = '标签') {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,，\s]+/);
  const cleaned = [...new Set(list.map((item) => String(item).trim().replace(/^#/, '')).filter(Boolean))];
  if (cleaned.length > 12) throw badRequest(`${field}最多 12 个`);
  if (cleaned.some((item) => item.length > 24)) throw badRequest('单个标签最多 24 个字符');
  return cleaned.join(' ');
}

export function folder(value) {
  return str(value, '目录', { max: 40, required: false, fallback: '默认' }).replace(/[\\/:*?"<>|]/g, '') || '默认';
}

/** 记录活动事件，供仪表盘趋势与动态使用。 */
export function logEvent(userId, kind, target = '', meta = '') {
  try {
    run(
      'INSERT INTO events (user_id, kind, target, meta, day) VALUES (?, ?, ?, ?, date(\'now\', \'localtime\'))',
      userId ?? null,
      String(kind).slice(0, 40),
      String(target).slice(0, 120),
      typeof meta === 'string' ? meta.slice(0, 200) : JSON.stringify(meta ?? {}).slice(0, 200),
    );
  } catch {
    /* 活动记录失败不应影响主流程 */
  }
}

