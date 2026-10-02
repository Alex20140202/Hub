/** DOM 与请求相关的最小工具集。 */

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/** 创建元素：el('div', {class: 'x'}, [child], 'text') */
export function el(tag, attrs = {}, children = [], text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [children, text].flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const debounce = (fn, wait = 280) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

/** 读取表单为普通对象，checkbox 取布尔，range / number 取数字。 */
export function formData(form) {
  const out = {};
  for (const [key, value] of new FormData(form)) {
    if (value instanceof File) continue;
    out[key] = typeof value === 'string' ? value.trim() : value;
  }
  for (const box of $$('input[type="checkbox"]', form)) {
    if (box.name) out[box.name] = box.checked;
  }
  for (const range of $$('input[type="range"]', form)) {
    if (range.name) out[range.name] = Number(range.value);
  }
  return out;
}
