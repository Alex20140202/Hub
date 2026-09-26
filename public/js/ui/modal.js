import { el, clear, on } from '../lib/dom.js';
import { toast } from './toast.js';

let openCount = 0;

/**
 * 通用弹窗
 * modal({ title, body, footer, wide, onMount, onClose })
 */
export function modal({ title = '', body, footer = null, wide = false, closable = true, onMount, onClose: onCloseOption = null } = {}) {
  const root = document.getElementById('modal-root');
  const prevFocus = document.activeElement;
  let onClose = onCloseOption;
  let onKey = null;

  const backdrop = el('div.modal-backdrop', { role: 'dialog', 'aria-modal': 'true' });
  const box = el(`div.modal${wide ? '.wide' : ''}`);

  const close = (result) => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    openCount--;
    if (openCount <= 0) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (prevFocus?.focus) prevFocus.focus();
    onClose?.(result);
  };

  const head = el('div.modal-head', {}, [
    el('h3', {}, title),
    closable ? el('button.icon-btn', { type: 'button', 'aria-label': '关闭', onclick: () => close() }, '×') : null,
  ]);
  const bodyNode = el('div.modal-body');
  if (body) bodyNode.append(body instanceof Node ? body : el('div', {}, body));
  box.append(head, bodyNode);

  if (footer) {
    const footNode = el('div.modal-foot');
    (Array.isArray(footer) ? footer : [footer]).forEach((f) => footNode.append(f));
    box.append(footNode);
  }

  backdrop.append(box);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && closable) close();
  });

  onKey = (e) => {
    if (e.key === 'Escape' && closable) {
      e.stopPropagation();
      close();
    }
    if (e.key === 'Tab') trapFocus(e, box);
  };
  document.addEventListener('keydown', onKey);

  root.append(backdrop);
  openCount++;
  document.body.style.overflow = 'hidden';
  onMount?.({ close, body: bodyNode, box });

  const focusTarget = box.querySelector('input, textarea, select, button:not(.icon-btn)');
  setTimeout(() => focusTarget?.focus(), 40);

  return { close, body: bodyNode, box, setFooter: (nodes) => {
    let footNode = box.querySelector('.modal-foot');
    if (!footNode) {
      footNode = el('div.modal-foot');
      box.append(footNode);
    }
    clear(footNode);
    (Array.isArray(nodes) ? nodes : [nodes]).forEach((n) => n && footNode.append(n));
  }, onClose: (fn) => { onClose = fn; } };
}

function trapFocus(e, container) {
  const focusables = container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** 确认对话框 */
export function confirmDialog({ title = '确认操作', message, confirmText = '确认', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const confirmBtn = el(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, {}, confirmText);
    const cancelBtn = el('button.btn.btn-ghost', { type: 'button' }, cancelText);
    const dlg = modal({
      title,
      body: el('p.soft', {}, message),
      footer: [cancelBtn, confirmBtn],
      onClose: (r) => resolve(r === true),
    });
    cancelBtn.addEventListener('click', () => dlg.close(false));
    // 必须以 true 关闭：close() 会同步触发 onClose，从而决定 Promise 的结果
    confirmBtn.addEventListener('click', () => dlg.close(true));
  });
}

/** 表单弹窗：根据字段描述自动生成表单，返回填写值 */
export function formDialog({ title, fields = [], submitText = '保存', wide = false, intro = null }) {
  return new Promise((resolve) => {
    const form = el('form', { onsubmit: (e) => e.preventDefault() });
    if (intro) form.append(el('p.soft.small', { style: { marginBottom: '16px' } }, intro));

    const controls = new Map();
    for (const field of fields) {
      const id = `f_${field.name}`;
      let input;
      if (field.type === 'textarea') {
        input = el('textarea.textarea', { id, name: field.name, rows: field.rows || 4, placeholder: field.placeholder || '' });
        input.value = field.value ?? '';
      } else if (field.type === 'select') {
        input = el('select.select', { id, name: field.name });
        (field.options || []).forEach((opt) => {
          const o = el('option', { value: opt.value }, opt.label);
          if (String(opt.value) === String(field.value)) o.selected = true;
          input.append(o);
        });
      } else if (field.type === 'checkbox') {
        input = el('input', { id, name: field.name, type: 'checkbox' });
        input.checked = !!field.value;
      } else {
        input = el('input.input', {
          id,
          name: field.name,
          type: field.type || 'text',
          placeholder: field.placeholder || '',
          step: field.step,
          min: field.min,
          max: field.max,
        });
        input.value = field.value ?? '';
      }
      controls.set(field.name, { input, field });

      const wrap = el('div.field', {}, [
        el('label', { for: id }, field.label + (field.required ? ' *' : '')),
        field.type === 'checkbox'
          ? el('label.checkbox', {}, [input, el('span', {}, field.checkboxLabel || '启用')])
          : input,
        field.hint ? el('span.hint', {}, field.hint) : null,
      ]);
      form.append(wrap);
    }

    const submitBtn = el('button.btn.btn-primary', { type: 'submit' }, submitText);
    const cancelBtn = el('button.btn.btn-ghost', { type: 'button' }, '取消');

    const collect = () => {
      const out = {};
      for (const [name, { input, field }] of controls) {
        out[name] = field.type === 'checkbox' ? input.checked : input.value;
      }
      return out;
    };

    const dlg = modal({
      title,
      wide,
      body: form,
      footer: [cancelBtn, submitBtn],
      onClose: () => resolve(null),
    });

    submitBtn.addEventListener('click', () => {
      const values = collect();
      for (const [name, { field }] of controls) {
        if (field.required && !String(values[name] ?? '').trim()) {
          toast.error(`请填写「${field.label}」`);
          return;
        }
      }
      dlg.close();
      resolve(values);
    });
    cancelBtn.addEventListener('click', () => dlg.close());
  });
}

/** 抽屉式详情（移动端友好） */
export function drawer({ title, body, footer }) {
  return modal({ title, body, footer, wide: true });
}

export { on };
