import { el } from '../lib/dom.js';

const host = () => document.getElementById('toast-host') ?? document.querySelector('[data-inline-host]');

/** 轻量提示。type: 'ok' | 'err' | 'info' */
export function toast(message, type = 'info', timeout = 3200) {
  const container = host();
  if (!container) return;

  const node = el('div', { class: `toast is-${type}` }, [message]);
  container.append(node);

  const remove = () => {
    node.classList.add('is-out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  };
  const timer = setTimeout(remove, timeout);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}

export const toastOk = (message) => toast(message, 'ok');
export const toastErr = (message) => toast(message, 'err', 4600);
