import { escapeHtml, icon } from './html.js';

/** 页头：标题 + 副标题 + 右侧操作区。 */
export const pageHead = (title, subtitle, action = '') =>
  `<div class="page-head">
    <div><h2 class="page-heading">${escapeHtml(title)}</h2>${subtitle ? `<p class="page-sub">${escapeHtml(subtitle)}</p>` : ''}</div>
    ${action}
  </div>`;

/** 空态：图标 + 主文案 + 提示 + 可选操作。 */
export const empty = (title, hint, action = '', iconName = 'notes') =>
  `<div class="empty">
     <div class="empty-mark" aria-hidden="true">${icon(iconName, 26)}</div>
     <p class="empty-title">${escapeHtml(title)}</p>
     ${hint ? `<p class="empty-hint">${escapeHtml(hint)}</p>` : ''}
     ${action}
   </div>`;

/** 统计卡片：标签 + 数值 + 辅助说明，左侧色条取 tone。 */
export const statCard = ({ label, value, hint, tone = '' }) =>
  `<div class="stat ${tone}">
     <span class="stat-label">${escapeHtml(label)}</span>
     <strong class="stat-value">${escapeHtml(String(value))}</strong>
     ${hint ? `<span class="stat-hint">${escapeHtml(hint)}</span>` : ''}
   </div>`;

/** 分页条。 */
export const pager = ({ page, pages, href }) => {
  if (pages <= 1) return '';
  const items = Array.from({ length: pages }, (_, index) => index + 1)
    .map(
      (n) =>
        `<a class="pager-item${n === page ? ' is-active' : ''}" href="${href(n)}"${n === page ? ' aria-current="page"' : ''}>${n}</a>`,
    )
    .join('');
  return `<nav class="pager" aria-label="分页">${items}</nav>`;
};

/** 把当前查询串与补丁合并成 href。 */
export const queryHref = (query, patch = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === '_partial' || value === '' || value === undefined) continue;
    params.set(key, value);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === '' || value === undefined || value === null) params.delete(key);
    else params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '?';
};
