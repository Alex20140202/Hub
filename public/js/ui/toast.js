import { el, clear } from '../lib/dom.js';

const stack = () => document.getElementById('toasts');

const ICONS = { success: '✓', error: '✕', info: 'ℹ', warning: '!' };

export function toast(message, type = 'info', { duration = 3200 } = {}) {
  const root = stack();
  if (!root) return () => {};

  const node = el(`div.toast.${type}`, { role: 'alert' }, [
    el('span.t-icon', {}, ICONS[type] || 'ℹ'),
    el('span.t-msg', {}, message),
    el('button.t-close', { type: 'button', 'aria-label': '关闭' }, '×'),
  ]);

  let timer;
  const close = () => {
    clearTimeout(timer);
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  };
  node.querySelector('.t-close').addEventListener('click', close);
  root.append(node);

  if (duration > 0) timer = setTimeout(close, duration);
  return close;
}

toast.success = (m, o) => toast(m, 'success', o);
toast.error = (m, o) => toast(m, 'error', { duration: 4800, ...o });
toast.info = (m, o) => toast(m, 'info', o);
toast.warning = (m, o) => toast(m, 'warning', o);

/** 处理带 <a> 的消息（HTML 需可信） */
toast.link = (text, href) => {
  const close = toast('', 'info', { duration: 6000 });
  const root = stack();
  const node = root.lastElementChild;
  const msg = node.querySelector('.t-msg');
  clear(msg);
  msg.append(document.createTextNode(text + ' '), el('a', { href }, '查看'));
  return close;
};
