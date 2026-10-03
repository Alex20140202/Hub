import { el, formData } from '../lib/dom.js';
import { openModal, closeModal } from '../ui/modal.js';
import { api } from '../lib/api.js';
import { toLocalInput } from '../lib/format.js';
import { toastOk, toastErr } from '../ui/toast.js';
import { refreshView } from '../lib/view.js';

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
      await refreshView();
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
      await refreshView();
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
      await refreshView();
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
          if (onUploaded) await onUploaded();
          else await refreshView();
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

/* --------------------------------- 短链 --------------------------------- */

export function shortModal() {
  formModal({
    title: '创建短链',
    submitText: '创建',
    fields: [
      field('目标网址', input('targetUrl', { placeholder: 'https://example.com/very/long/path', required: true, autofocus: true })),
      field('自定义短码', input('code', { maxlength: 32, placeholder: '留空自动生成' }), '只能用字母、数字、- 和 _'),
      field('备注', input('title', { maxlength: 120, placeholder: '方便自己辨认' })),
    ],
    onSubmit: async (values) => {
      const result = await api.shorts.create(values);
      toastOk(`已创建 ${location.origin}/s/${result.short.code}`);
      await refreshView();
    },
  });
}

/* ------------------------------- 聊天室弹窗 ------------------------------- */

/** 可拉人/可私聊的候选用户（排除自己与已在房间里的人）。 */
async function candidateUsers(exclude = []) {
  const { peers } = await api.dms.list();
  const skip = new Set([...exclude, stateUserId()]);
  return peers.filter((user) => !skip.has(user.id));
}

let currentUserId = null;
export function bindCurrentUser(id) {
  currentUserId = id;
}
const stateUserId = () => currentUserId;

const userPicker = (users) =>
  el(
    'div',
    { class: 'user-picker' },
    users.length
      ? users.map((user) =>
          el(
            'label',
            { class: 'user-option' },
            [
              el('input', { type: 'checkbox', value: user.id }),
              el('span', { class: 'avatar avatar-sm', style: `--hue:${Number(user.avatarHue) || 210}` }, [
                (user.nickname || '?').slice(0, 1).toUpperCase(),
              ]),
              el('span', { class: 'user-option-text' }, [
                el('strong', {}, [user.nickname]),
                el('em', {}, [`@${user.username}`]),
              ]),
            ],
          ),
        )
      : el('p', { class: 'hint' }, ['没有其他用户可选']),
  );

/** 创建群聊：可同时勾选首批成员。 */
export async function newRoomModal() {
  let users = [];
  try {
    users = await candidateUsers();
  } catch (error) {
    return toastErr(error.message);
  }

  formModal({
    title: '创建群聊',
    submitText: '创建',
    fields: [
      field('群名称', input('name', { maxlength: 40, placeholder: '例如：前端摸鱼群', required: true, autofocus: true })),
      field('群简介', input('topic', { maxlength: 200, placeholder: '这个群用来做什么' })),
      el('label', { class: 'field' }, [
        el('span', {}, ['首批成员（可留空，之后再拉人）']),
        userPicker(users),
      ]),
      el('label', { class: 'field field-inline' }, [
        el('input', { type: 'checkbox', name: 'isPublic', checked: true }),
        el('span', {}, ['公开群（其他人可以在「发现公开群」里加入）']),
      ]),
    ],
    onSubmit: async (values, form) => {
      const memberIds = [...form.querySelectorAll('.user-picker input:checked')].map((box) => Number(box.value));
      const { room } = await api.rooms.create({
        name: values.name,
        topic: values.topic,
        isPublic: values.isPublic !== false,
        memberIds,
      });
      toastOk(`群「${room.name}」已创建`);
      setTimeout(() => {
        location.assign(`/chat?room=${encodeURIComponent(room.code)}`);
      }, 500);
    },
  });
}

/** 发起私聊。 */
export async function newDmModal() {
  let users = [];
  try {
    const { peers } = await api.dms.list();
    users = peers;
  } catch (error) {
    return toastErr(error.message);
  }

  formModal({
    title: '发起私聊',
    submitText: '开始私聊',
    width: 460,
    fields: [
      el(
        'div',
        { class: 'form' },
        users.length
          ? users.map((user) =>
              el(
                'button',
                {
                  class: 'user-option user-option-button',
                  type: 'button',
                  onClick: async () => {
                    try {
                      const { room } = await api.dms.open(user.id);
                      closeModal();
                      location.assign(`/chat?room=${encodeURIComponent(room.code)}`);
                    } catch (error) {
                      toastErr(error.message);
                    }
                  },
                },
                [
                  el('span', { class: 'avatar avatar-sm', style: `--hue:${Number(user.avatarHue) || 210}` }, [
                    (user.nickname || '?').slice(0, 1).toUpperCase(),
                  ]),
                  el('span', { class: 'user-option-text' }, [el('strong', {}, [user.nickname]), el('em', {}, [`@${user.username}`])]),
                ],
              ),
            )
          : [el('p', { class: 'hint' }, ['还没有其他用户，先邀请一个来注册吧'])],
      ),
    ],
    onSubmit: async () => {},
  });
}

/** 拉人进群。 */
export async function inviteModal(code) {
  let users = [];
  try {
    const memberData = await api.rooms.members(code);
    users = await candidateUsers(memberData.items.map((member) => member.id));
  } catch (error) {
    return toastErr(error.message);
  }

  formModal({
    title: '邀请成员',
    submitText: '邀请',
    width: 460,
    fields: [el('label', { class: 'field' }, [el('span', {}, ['选择要邀请的用户']), userPicker(users)])],
    onSubmit: async (values, form) => {
      const userIds = [...form.querySelectorAll('.user-picker input:checked')].map((box) => Number(box.value));
      if (!userIds.length) throw new Error('请至少选择一位用户');
      const result = await api.rooms.addMembers(code, userIds);
      toastOk(result.added.length ? `已邀请 ${result.added.length} 人` : '对方已在房间里');
    },
  });
}

/** 群设置：改名、改简介、公开性、人数上限。 */
export async function roomSettingsModal(code) {
  let room = null;
  try {
    room = (await api.rooms.members(code)).room;
  } catch (error) {
    return toastErr(error.message);
  }
  if (!room) return toastErr('房间不存在');

  formModal({
    title: '群设置',
    submitText: '保存',
    fields: [
      field('群名称', input('name', { value: room.name, maxlength: 40, required: true })),
      field('群简介', input('topic', { value: room.topic, maxlength: 200 })),
      field('人数上限', input('maxMembers', { type: 'number', value: room.maxMembers, min: 2, max: 200 })),
      el('label', { class: 'field field-inline' }, [
        el('input', { type: 'checkbox', name: 'isPublic', checked: room.isPublic }),
        el('span', {}, ['公开群（可被搜索与发现）']),
      ]),
    ],
    onSubmit: async (values) => {
      await api.rooms.update(code, {
        name: values.name,
        topic: values.topic,
        maxMembers: Number(values.maxMembers),
        isPublic: values.isPublic !== false,
      });
      toastOk('已保存');
      setTimeout(() => location.reload(), 400);
    },
  });
}
