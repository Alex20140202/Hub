import { $, el } from '../lib/dom.js';

let closeCurrent = null;
let currentOnClose = null;

/**
 * 打开模态框。build(api) 需返回 { title, body, footer } 或 HTMLElement。
 * api 提供 close()、submit()，并处理 Esc / 遮罩点击 / 焦点陷阱。
 */
export function openModal({ title, build, width, className = '' }) {
  closeModal();

  const host = $('#modal-host');
  if (!host) return null;

  const backdrop = el('div', { class: 'modal-backdrop' });
  const panel = el('div', {
    class: `modal${className ? ` ${className}` : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
    style: width ? `width:min(100%,${width}px)` : '',
  });
  const body = el('div', { class: 'modal-body' });
  const foot = el('div', { class: 'modal-foot' });

  let done = false;
  const close = (result) => {
    if (done) return;
    done = true;
    document.removeEventListener('keydown', onKey, true);
    host.hidden = true;
    host.replaceChildren();
    document.body.style.removeProperty('overflow');
    closeCurrent = null;
    const hook = currentOnClose;
    currentOnClose = null;
    hook?.(result);
  };

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    // 焦点陷阱：Tab 始终在模态内循环
    const focusable = [...panel.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const content = build?.({ close, body, foot, panel }) ?? {};
  currentOnClose = content.onClose ?? null;

  if (content.title || title) {
    panel.append(
      el('div', { class: 'modal-head' }, [
        el('h3', {}, [content.title ?? title]),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭', onClick: () => close() }, ['✕']),
      ]),
    );
  }
  panel.append(body, content.footer ? foot : '');
  if (content.footer) foot.append(...[].concat(content.footer));

  host.replaceChildren(backdrop, panel);
  host.hidden = false;
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('click', () => close());

  const auto = panel.querySelector('[autofocus], input, textarea, select, button');
  auto?.focus();

  closeCurrent = close;
  return close;
}

export function closeModal() {
  closeCurrent?.();
}

/** 确认对话框，返回 Promise<boolean>。 */
export function confirmModal({ title = '确认操作', message, confirmText = '确认', danger = true }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    openModal({
      title,
      width: 420,
      build: ({ close, body, foot }) => {
        body.append(el('p', {}, [message]));
        foot.append(
          el('button', { class: 'btn', type: 'button', onClick: () => close(false) }, ['取消']),
          el(
            'button',
            {
              class: danger ? 'btn btn-danger' : 'btn btn-primary',
              type: 'button',
              onClick: () => close(true),
            },
            [confirmText],
          ),
        );
        return { footer: true, onClose: finish };
      },
    });
  });
}
