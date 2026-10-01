import { el, initials } from '../lib/dom.js';

/**
 * 依据背景色亮度挑选前景色。
 * 头像是「彩色底 + 字母」，而色板里既有深紫也有亮橙，
 * 一律用白字会让亮色底上的字母几乎看不清（实测低至 2.0:1）。
 */
export function avatarInk(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  if (!m) return '#fff';
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // 取「白字 / 深色字」中对比度更高的那个。
  // 注意深色墨水 #10141f 自身的亮度约 0.007，分母要用 L+0.05 而不是 0.05，
  // 否则会把 #6366f1 这类色判成「深色字更好」，实际白字反而更清楚。
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const onWhite = ratio(L, 1);
  const onDark = ratio(L, 0.00714);
  return onWhite >= onDark ? '#ffffff' : '#10141f';
}

/** 头像 */
export function avatar(user, size = '') {
  const name = user?.nickname || user?.username || user?.author?.nickname || '?';
  const color = user?.avatarColor || user?.avatar_color || user?.author?.avatarColor || '#6366f1';
  const cls = `avatar${size ? ` ${size}` : ''}`.split(' ').map((c) => `.${c}`).join('');
  if (user?.avatarUrl) {
    return el(cls, { style: { background: 'none' } }, [
      el('img', { src: user.avatarUrl, alt: name, style: { borderRadius: '50%', width: '100%', height: '100%', objectFit: 'cover' } }),
    ]);
  }
  return el(cls, { style: { background: color, color: avatarInk(color) }, title: name }, initials(name));
}

/** 带商城头像框的头像 */
export function avatarFramed(user, size = '') {
  const node = avatar(user, size);
  const frame = user?.frame;
  if (!frame) return node;
  return el(`div.avatar-wrap.frame-${frame}`, {}, [node, el('i.frame-ring')]);
}

/** 徽标 */
export function badge(text, kind = '') {
  return el(`span.badge${kind ? `.badge-${kind}` : ''}`, {}, text);
}

export function statusBadge(status) {
  const map = {
    published: ['已发布', 'success'],
    draft: ['草稿', 'warning'],
    pending: ['待审核', 'warning'],
    spam: ['垃圾', 'danger'],
  };
  const [label, kind] = map[status] || [status, ''];
  return badge(label, kind);
}

/** 空状态 */
export function empty(title, description, action = null, icon = '🗂') {
  return el('div.empty', {}, [
    el('div.icon', {}, icon),
    el('h3', {}, title),
    description ? el('p', {}, description) : null,
    action ? el('div', { style: { marginTop: '16px' } }, action) : null,
  ]);
}

/** 骨架屏 */
export function skeleton(count = 3, { title = false } = {}) {
  return el(
    'div.col',
    { style: { gap: '18px' } },
    Array.from({ length: count }, () =>
      el('div.card', {}, [
        title ? el('div.skeleton.sk-title') : null,
        el('div.skeleton.sk-line', { style: { width: '92%' } }),
        el('div.skeleton.sk-line', { style: { width: '78%' } }),
        el('div.skeleton.sk-line', { style: { width: '46%' } }),
      ]),
    ),
  );
}

/** 分页器 */
export function pager({ page = 1, pages = 1, onChange }) {
  if (pages <= 1) return null;
  const box = el('div.pager');
  const btn = (label, target, disabled = false, active = false) =>
    el(`button${active ? '.active' : ''}`, {
      type: 'button',
      disabled,
      onclick: () => target !== page && onChange(target),
    }, label);

  box.append(btn('‹', page - 1, page <= 1));

  const list = [];
  const push = (p) => list.push(p);
  if (pages <= 7) {
    for (let i = 1; i <= pages; i++) push(i);
  } else {
    push(1);
    if (page > 3) list.push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(pages - 1, page + 1); i++) push(i);
    if (page < pages - 2) list.push('…');
    push(pages);
  }
  for (const p of list) {
    box.append(p === '…' ? el('span.muted', { style: { padding: '0 4px' } }, '…') : btn(String(p), p, false, p === page));
  }
  box.append(btn('›', page + 1, page >= pages));
  return box;
}

/** 进度条 */
export function progress(value, max = 100) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return el('div.progress', { role: 'progressbar', 'aria-valuenow': String(Math.round(pct)) }, [
    el('i', { style: { width: `${pct}%` } }),
  ]);
}

/** 环形进度 */
export function ring(percent, { size = 96 } = {}) {
  const node = el('div.ring', { style: { '--p': String(percent), width: `${size}px`, height: `${size}px` } }, [
    el('span.val', {}, `${percent}%`),
  ]);
  return node;
}

/** 统计卡片 */
export function statCard({ label, value, delta = null, icon = '', hint = '' }) {
  return el('div.stat', {}, [
    el('div.k', {}, [icon ? el('span', {}, icon) : null, label]),
    el('div.v', {}, typeof value === 'number' ? value.toLocaleString('zh-CN') : value),
    delta ? el(`div.delta.${delta.direction || 'up'}`, {}, delta.text) : hint ? el('div.small.muted', {}, hint) : null,
  ]);
}

/** 带标签的输入 */
let fieldSeq = 0;
export function field(label, control, { hint = '', required = false } = {}) {
  // 控件没有 id 时自动补一个：否则 <label for> 指向空，
  // 读屏软件读不到标签，点击标签也不会聚焦控件。
  if (control.tagName !== 'LABEL' && !control.id) {
    control.id = `field-${++fieldSeq}`;
  }
  return el('div.field', {}, [
    control.tagName === 'LABEL'
      ? control
      : el('label', { for: control.id }, [label, required ? el('span', { style: { color: 'var(--danger)' } }, ' *') : null]),
    control,
    hint ? el('span.hint', {}, hint) : null,
  ]);
}

export function input(props = {}) {
  return el('input.input', props);
}

export function textarea(props = {}) {
  return el('textarea.textarea', props);
}

export function select(options, props = {}) {
  const node = el('select.select', props);
  options.forEach((o) => {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    node.append(el('option', { value: opt.value }, opt.label));
  });
  return node;
}

export function tabs(items, active, onChange) {
  const box = el('div.tabs');
  items.forEach((item) => {
    const btn = el(`button${item.key === active ? '.active' : ''}`, { type: 'button' }, item.label);
    btn.addEventListener('click', () => {
      box.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(item.key);
    });
    box.append(btn);
  });
  return box;
}

/** 标签输入 */
export function tagInput(initial = [], { placeholder = '输入后回车添加' } = {}) {
  const wrap = el('div.col', { style: { gap: '8px' } });
  const chips = el('div.row.wrap', { style: { gap: '6px' } });
  const list = [...initial];
  const input = el('input.input', { 'aria-label': '标签', placeholder, type: 'text' });

  const render = () => {
    chips.replaceChildren();
    list.forEach((tag) => {
      chips.append(
        el('span.badge.badge-brand', {}, [
          tag,
          el('button', {
            type: 'button',
            style: { color: 'inherit', fontSize: '1rem', lineHeight: '1' },
            'aria-label': `移除 ${tag}`,
            onclick: () => {
              const i = list.indexOf(tag);
              if (i >= 0) list.splice(i, 1);
              render();
            },
          }, '×'),
        ]),
      );
    });
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = input.value.trim().replace(/,$/, '');
      if (v && !list.includes(v) && list.length < 12) {
        list.push(v);
        render();
      }
      input.value = '';
    } else if (e.key === 'Backspace' && !input.value && list.length) {
      list.pop();
      render();
    }
  });

  render();
  wrap.append(input, chips);
  wrap.getValues = () => [...list];
  return wrap;
}

/** 分段选择 */
export function segmented(options, active, onChange) {
  const box = el('div.row.wrap', { style: { gap: '6px' } });
  options.forEach((opt) => {
    const btn = el(`button.chip${opt.value === active ? '.active' : ''}`, { type: 'button' }, opt.label);
    btn.addEventListener('click', () => {
      box.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      onChange(opt.value);
    });
    box.append(btn);
  });
  return box;
}

export function copyable(text, label = '复制') {
  const btn = el('button.btn.btn-ghost.btn-sm', { type: 'button' }, label);
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '已复制 ✓';
      setTimeout(() => (btn.textContent = label), 1500);
    } catch {
      btn.textContent = '复制失败';
      setTimeout(() => (btn.textContent = label), 1500);
    }
  });
  return btn;
}
