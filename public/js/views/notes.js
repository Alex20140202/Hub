import { el, clear, debounce } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { NoteAPI } from '../lib/api.js';
import { timeAgo, dateTime } from '../lib/format.js';
import { empty, skeleton, tagInput } from '../ui/components.js';
import { modal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { go } from '../lib/router.js';

const COLORS = [
  { value: 'default', label: '默认', cls: '' },
  { value: 'blue', label: '蓝', cls: 'c-blue' },
  { value: 'green', label: '绿', cls: 'c-green' },
  { value: 'orange', label: '橙', cls: 'c-orange' },
  { value: 'red', label: '红', cls: 'c-red' },
  { value: 'purple', label: '紫', cls: 'c-purple' },
];

export default async function notesView(host, ctx) {
  const state = { q: '', archived: ctx.query.archived === '1', items: [] };
  const grid = el('div.notes-grid');
  const toolbar = el('div.row-between.wrap', { style: { marginBottom: '18px' } });

  host.append(
    el('div.page-head', {}, [
      el('div.row-between.wrap', {}, [
        el('div', {}, [el('h1', {}, state.archived ? '归档笔记' : '我的笔记'), el('p', {}, '把碎片想法随手记下来')]),
        el('div.row', {}, [
          el('a.btn.btn-ghost', { href: `#/notes?archived=${state.archived ? '0' : '1'}` }, state.archived ? '返回笔记' : '查看归档'),
          el('button.btn.btn-primary', { type: 'button', onclick: () => openEditor() }, '✚ 新建笔记'),
        ]),
      ]),
    ]),
    toolbar,
    grid,
  );

  const search = el('input.input', { type: 'search', 'aria-label': '搜索笔记', placeholder: '搜索标题或内容…', style: { maxWidth: '280px' } });
  search.addEventListener('input', debounce(() => {
    state.q = search.value.trim();
    load();
  }, 300));
  toolbar.append(search, el('span.small.muted#note-count', {}, ''));

  async function load() {
    grid.replaceChildren(skeleton(3));
    try {
      const data = await NoteAPI.list({ q: state.q, archived: state.archived });
      state.items = data.items;
      grid.replaceChildren();
      const counter = document.getElementById('note-count');
      if (counter) counter.textContent = `${data.items.length} 条笔记`;
      if (!data.items.length) {
        grid.replaceChildren();
        grid.style.columns = 'auto';
        grid.append(
          empty('还没有笔记', '记录会议纪要、灵感碎片或待读清单', el('button.btn.btn-primary', { type: 'button', onclick: () => openEditor() }, '写第一条'), '📓'),
        );
        return;
      }
      grid.style.columns = '';
      for (const note of data.items) grid.append(noteCard(note));
    } catch (err) {
      grid.replaceChildren(el('div.alert.alert-danger', {}, err.message));
    }
  }

  function noteCard(note) {
    const color = COLORS.find((c) => c.value === note.color) || COLORS[0];
    const node = el(`div.note.${color.cls}`, { tabindex: '0', role: 'button' }, [
      el('div.row', { style: { marginBottom: '4px' } }, [
        el('h4.grow.truncate', {}, note.title),
        note.pinned ? el('span', { title: '已置顶' }, '📌') : null,
      ]),
      el('div.content.clamp-3', {}, note.content || '（空）'),
      note.tags.length ? el('div.row.wrap', { style: { gap: '4px', marginTop: '8px' } }, note.tags.map((t) => el('span.badge', {}, `#${t}`))) : null,
      el('div.foot', {}, [
        el('span', {}, timeAgo(note.updatedAt)),
        el('span.row.note-actions', {}, [
          el('button.icon-btn', {
            type: 'button', title: '置顶', 'aria-label': note.pinned ? '取消置顶' : '置顶',
            onclick: (e) => { e.stopPropagation(); pin(note); },
          }, note.pinned ? '📌' : '📍'),
          el('button.icon-btn', {
            type: 'button', title: '更多', 'aria-label': '更多操作',
            onclick: (e) => { e.stopPropagation(); openEditor(note); },
          }, '⋯'),
        ]),
      ]),
    ]);
    node.addEventListener('click', () => openEditor(note));
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openEditor(note);
    });
    return node;
  }

  async function pin(note) {
    try {
      await NoteAPI.update(note.id, { pinned: !note.pinned });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  function openEditor(note = null) {
    let titleInput, contentInput, tagsWidget, pinnedInput;
    let colorValue = note?.color || 'default';

    const colorRow = el('div.row.wrap', { style: { gap: '6px' } });
    const renderColors = () => {
      colorRow.replaceChildren();
      for (const c of COLORS) {
        const btn = el(`button.chip${c.value === colorValue ? '.active' : ''}`, { type: 'button' }, c.label);
        btn.addEventListener('click', () => {
          colorValue = c.value;
          renderColors();
        });
        colorRow.append(btn);
      }
    };
    renderColors();

    const body = el('form', { onsubmit: (e) => e.preventDefault() }, [
      el('div.field', {}, [
        el('label', {}, '标题'),
        (titleInput = el('input.input', { 'aria-label': '笔记标题', placeholder: '这条笔记讲什么？', value: note?.title || '' })),
      ]),
      el('div.field', {}, [
        el('label', {}, '内容'),
        (contentInput = el('textarea.textarea', { rows: 12, 'aria-label': '笔记内容', placeholder: '支持纯文本，Enter 换行' })),
      ]),
      el('div.field', {}, [el('label', {}, '颜色'), colorRow]),
      el('div.field', {}, [el('label', {}, '标签'), (tagsWidget = tagInput(note?.tags || []))]),
      el('label.switch', {}, [(pinnedInput = el('input', { type: 'checkbox' })), el('span.track'), el('span.small', {}, '置顶这条笔记')]),
    ]);
    contentInput.value = note?.content || '';
    pinnedInput.checked = !!note?.pinned;

    const saveBtn = el('button.btn.btn-primary', { type: 'button' }, note ? '保存' : '创建');
    const deleteBtn = note
      ? el('button.btn.btn-outline-danger', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmDialog({ title: '删除笔记', message: `确定删除「${note.title}」？`, confirmText: '删除', danger: true }))) return;
            try {
              await NoteAPI.remove(note.id);
              dlg.close();
              toast.success('笔记已删除');
              load();
            } catch (err) {
              toast.error(err.message);
            }
          },
        }, '删除')
      : null;

    const dlg = modal({
      title: note ? '编辑笔记' : '新建笔记',
      wide: true,
      body,
      footer: [deleteBtn, saveBtn],
    });

    saveBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) return toast.warning('请填写标题');
      saveBtn.setAttribute('aria-busy', 'true');
      try {
        const payload = {
          title,
          content: contentInput.value,
          color: colorValue,
          pinned: pinnedInput.checked,
          tags: tagsWidget.getValues(),
        };
        if (note) await NoteAPI.update(note.id, payload);
        else await NoteAPI.create(payload);
        dlg.close();
        toast.success(note ? '笔记已保存' : '笔记已创建');
        load();
      } catch (err) {
        toast.error(err.message);
        saveBtn.removeAttribute('aria-busy');
      }
    });

    setTimeout(() => titleInput.focus(), 60);
  }

  await load();
  if (ctx.query.new) openEditor();
}
