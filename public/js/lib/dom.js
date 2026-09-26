/** 极简 DOM 工具集 */

/** 创建元素：el('div.card#main', { onclick }, [children]) */
export function el(spec, props = null, children = null) {
  const parts = String(spec).split('.');
  let tag = 'div';
  let id = null;
  const classes = [];
  parts.forEach((seg, i) => {
    const eq = seg.indexOf('#');
    const name = eq >= 0 ? seg.slice(0, eq) : seg;
    if (eq >= 0) id = seg.slice(eq + 1);
    if (!name) return;
    if (i === 0) tag = name;
    else classes.push(name);
  });
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class' || key === 'className') {
        node.className = [node.className, value].filter(Boolean).join(' ');
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(node.style, value);
      } else if (key === 'dataset') {
        Object.assign(node.dataset, value);
      } else if (key === 'html') {
        node.innerHTML = value;
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2), value);
      } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') {
        node[key] = value;
      } else {
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }

  append(node, children);
  return node;
}

export function append(parent, children) {
  if (children === null || children === undefined || children === false) return parent;
  if (Array.isArray(children)) {
    for (const child of children) append(parent, child);
    return parent;
  }
  parent.append(children instanceof Node ? children : document.createTextNode(String(children)));
  return parent;
}

export function frag(children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, children) {
  clear(node);
  append(node, children);
  return node;
}

export function on(node, event, selector, handler) {
  node.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && node.contains(target)) handler(e, target);
  });
  return node;
}

/** HTML 转义 */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function initials(name) {
  const s = String(name || '?').trim();
  if (/^[\u4e00-\u9fa5]/.test(s)) return s.slice(-2);
  const parts = s.split(/[\s_-]+/).filter(Boolean);
  return (parts[0]?.[0] || s[0] || '?').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
}

export function debounce(fn, wait = 260) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function throttle(fn, wait = 100) {
  let last = 0;
  let timer;
  return (...args) => {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, wait - (now - last));
    }
  };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function scrollTop(smooth = true) {
  window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
}
