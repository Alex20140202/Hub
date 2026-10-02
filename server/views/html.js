/** HTML 转义与轻量模板工具。所有插值默认转义，避免 XSS。 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (value) =>
  value === null || value === undefined ? '' : String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);

/** 模板字面量：数组自动 join，其余按原样插入。 */
export function html(strings, ...values) {
  return strings.reduce((out, chunk, index) => {
    const value = values[index - 1];
    if (value === undefined || value === null || value === false) return out + chunk;
    if (Array.isArray(value)) return out + value.join('') + chunk;
    return out + value + chunk;
  });
}

/** 标签页插入 `<!--raw-->` 包裹的内容时使用：跳过转义（仅用于已自建可信 HTML）。 */
export const raw = (value) => ({ toString: () => value, __raw: true });

/** 序列化到 <script type="application/json">，需转义 </ 与 HTML 注释序列。 */
export const jsonScript = (data) =>
  JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export const attr = (value) => escapeHtml(value);

const ICONS = {
  dashboard: '<path d="M4 4h6v7H4zM14 4h6v4h-6zM14 11h6v9h-6zM4 14h6v6H4z"/>',
  notes: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h4"/>',
  todos: '<path d="M4 7h4M4 12h4M4 17h4M11 7h9M11 12h9M11 17h9"/>',
  links: '<path d="M10 14a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-6-.5l-2 2A4 4 0 0 0 11.7 17l1-1"/>',
  files: '<path d="M4 6h5l2 3h9v10H4z"/><path d="M4 6V4h5l2 3"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  admin: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  blog: '<path d="M4 5h11a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2M8 9h6M8 13h6"/>',
  short: '<path d="M10 13a5 5 0 0 0 7 .5l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7-.5l-2 2a5 5 0 0 0 7 7l1-1"/>',
  chat: '<path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/>',
  points: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h5M9.5 14.5h5"/>',
  editor: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/>',
  tag: '<path d="M4 12V4h8l8 8-8 8z"/><circle cx="8" cy="8" r="1.4"/>',
  heart: '<path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9z"/>',
  comment: '<path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/>',
  eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
  flame: '<path d="M12 3c3 3 5 5 5 8a5 5 0 0 1-10 0c0-1.5.8-3 2-4 .3 1.2 1 2 2 2 1.4 0 1-2 1-6z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5H6a2 2 0 0 0-2 2v9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M15 17l5-5-5-5M20 12H9M12 3H5v18h7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  moon: '<path d="M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10z"/>',
};

/** 内联 SVG 图标（24x24 线性图标，随 currentColor 变色）。 */
export const icon = (name, size = 18) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
    ICONS[name] ?? ''
  }</svg>`;

export const initials = (name) => String(name || '?').trim().slice(0, 1).toUpperCase() || '?';
