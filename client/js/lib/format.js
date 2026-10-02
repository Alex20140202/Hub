/** 客户端格式化工具，与 server/views/format.js 保持一致的口径。 */

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unit]}`;
}

export const formatNumber = (value) => new Intl.NumberFormat('zh-CN').format(Number(value) || 0);

const UNITS = [
  { limit: 60, seconds: 1, unit: '秒' },
  { limit: 3600, seconds: 60, unit: '分钟' },
  { limit: 86400, seconds: 3600, unit: '小时' },
  { limit: 604800, seconds: 86400, unit: '天' },
  { limit: 2592000, seconds: 604800, unit: '周' },
  { limit: 31536000, seconds: 2592000, unit: '个月' },
];

export const parseTime = (value) => {
  if (!value) return null;
  const text = String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function fromNow(value) {
  const date = parseTime(value);
  if (!date) return '';
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 0) return '即将';
  if (diff < 45) return '刚刚';
  for (const { limit, seconds, unit } of UNITS) {
    if (diff < limit) return `${Math.floor(diff / seconds)} ${unit}前`;
  }
  return date.toLocaleDateString('zh-CN');
}

/** <input type="datetime-local"> 需要本地时间字符串（YYYY-MM-DDTHH:mm）。 */
export const toLocalInput = (value) => {
  const date = parseTime(value);
  if (!date) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
