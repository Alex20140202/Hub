import { el, formData } from '../lib/dom.js';
import { openModal } from '../ui/modal.js';
import { api } from '../lib/api.js';
import { toLocalInput } from '../lib/format.js';
import { toastOk, toastErr } from '../ui/toast.js';

const COLORS = [
  ['slate', '默认'],
  ['indigo', '靛蓝'],
  ['emerald', '翠绿'],
  ['amber', '琥珀'],
  ['rose', '玫红'],
  ['cyan', '青蓝'],
];

const PRIORITIES = [
  ['high', '高'],
  ['normal', '中'],
  ['low', '低'],
];

const field = (label, control, hint) =>
  el('label', { class: 'field' }, [el('span', {}, [label]), control, hint ? el('em', {}, [hint]) : null]);

const input = (name, attrs = {}) => el('input', { class: 'input', name, ...attrs });
const textarea = (name, attrs = {}) => el('textarea', { class: 'input', name, ...attrs });
const select = (name, options, value) =>
  el(
    'select',
    { class: 'input', name },
    options.map(([optionValue, label]) => el('option', { value: optionValue, selected: optionValue === value }, [label])),
  );

/** 通用表单弹窗：build 负责构造字段，onSubmit 返回 Promise。 */
function formModal({ title, fields, submitText = '保存', onSubmit }) {
  openModal({
    title,
    width: 560,
    build: ({ close, body, foot }) => {
      const form = el('form', { class: 'form', novalidate: true }, fields);
      const error = el('p', { class: 'form-error', hidden: true });
      const submit = el('button', { class: 'btn btn-primary', type: 'submit' }, [submitText]);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        error.hidden = true;
        try {
          await onSubmit(formData(form));
          close(true);
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        } finally {
          submit.disabled = false;
        }
      });

      form.append(error);
      body.append(form);
      foot.append(el('button', { class: 'btn', type: 'button', onClick: () => close(false) }, ['取消']), submit);
      return { footer: true };
    },
  });
}

/* --------------------------------- 笔记 --------------------------------- */

export function noteModal(note) {
  const editing = Boolean(note?.id);
  formModal({
    title: editing ? '编辑笔记' : '新建笔记',
    submitText: editing ? '保存修改' : '创建',
    fields: [
      field('标题', input('title', { maxlength: 120, placeholder: '给这条笔记起个名字', autofocus: true, value: note?.title ?? '' })),
      field('正文', textarea('body', { rows: 7, placeholder: '写点什么…', maxlength: 20000 }), '空行分段'),
      field('标签', input('tags', { placeholder: '用空格或逗号分隔', value: (note?.tags ?? []).join(' ') })),
      field('颜色', select('color', COLORS, note?.color ?? 'slate')),
      el('label', { class: 'field field-inline' }, [
        el('input', { type: 'checkbox', name: 'pinned', checked: Boolean(note?.pinned) }),
        el('span', {}, ['置顶这条笔记']),
      ]),
    ],
    onSubmit: async (values) => {
      const payload = { ...values, pinned: Boolean(values.pinned) };
      if (editing) await api.notes.update(note.id, payload);
      else await api.notes.create(payload);
      toastOk(editing ? '笔记已更新' : '笔记已创建');
    },
  });
}

/* --------------------------------- 待办 --------------------------------- */

export function todoModal(todo) {
  const editing = Boolean(todo?.id);
  formModal({
    title: editing ? '编辑待办' : '新建待办',
    submitText: editing ? '保存修改' : '添加',
    fields: [
      field('要做什么', input('title', { maxlength: 160, placeholder: '一件具体可执行的事', autofocus: true, value: todo?.title ?? '' })),
      field('备注', textarea('detail', { rows: 3, maxlength: 2000, value: todo?.detail ?? '' })),
      field('优先级', select('priority', PRIORITIES, todo?.priority ?? 'normal')),
      field('截止时间', input('dueAt', { type: 'datetime-local', value: toLocalInput(todo?.dueAt) }), '留空表示不限期'),
    ],
    onSubmit: async (values) => {
      const payload = { ...values, dueAt: values.dueAt ? values.dueAt.replace('T', ' ') : null };
      if (editing) await api.todos.update(todo.id, payload);
      else await api.todos.create(payload);
      toastOk(editing ? '待办已更新' : '待办已添加');
    },
  });
}

/* --------------------------------- 书签 --------------------------------- */

export function linkModal(link) {
  const editing = Boolean(link?.id);
  formModal({
    title: editing ? '编辑书签' : '新建书签',
    submitText: editing ? '保存修改' : '收藏',
    fields: [
      field('网址', input('url', { placeholder: 'https://example.com', value: link?.url ?? '', autofocus: !editing })),
      field('标题', input('title', { maxlength: 160, placeholder: '留空则用域名', value: link?.title ?? '' })),
      field('描述', textarea('description', { rows: 3, maxlength: 300, value: link?.description ?? '' })),
      field('标签', input('tags', { placeholder: '用空格或逗号分隔', value: (link?.tags ?? []).join(' ') })),
      el('label', { class: 'field field-inline' }, [
        el('input', { type: 'checkbox', name: 'starred', checked: Boolean(link?.starred) }),
        el('span', {}, ['标星（置顶显示）']),
      ]),
    ],
    onSubmit: async (values) => {
      if (editing) await api.links.update(link.id, values);
      else await api.links.create(values);
      toastOk(editing ? '书签已更新' : '已收藏');
    },
  });
}

/* --------------------------------- 文件 --------------------------------- */

export function uploadModal(onUploaded) {
  openModal({
    title: '上传文件',
    width: 480,
    build: ({ close, body, foot }) => {
      const picker = el('input', { class: 'input', type: 'file', name: 'file' });
      const folder = input('folder', { placeholder: '默认', maxlength: 40 });
      const status = el('p', { class: 'hint' }, ['选择文件后即可上传']);
      const submit = el('button', { class: 'btn btn-primary', type: 'submit' }, ['上传']);

      picker.addEventListener('change', () => {
        const file = picker.files?.[0];
        if (file) status.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
      });

      const form = el('form', { class: 'form' }, [field('选择文件', picker), field('目录', folder), status]);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const file = picker.files?.[0];
        if (!file) {
          status.textContent = '请先选择文件';
          return;
        }
        submit.disabled = true;
        try {
          const body = new FormData();
          body.append('file', file);
          if (folder.value.trim()) body.append('folder', folder.value.trim());
          await api.files.upload(body);
          close(true);
          toastOk('上传成功');
          onUploaded?.();
        } catch (error) {
          toastErr(error.message);
        } finally {
          submit.disabled = false;
        }
      });

      body.append(form);
      foot.append(el('button', { class: 'btn', type: 'button', onClick: () => close(false) }, ['取消']), submit);
      return { footer: true };
    },
  });
}
