import { el, debounce } from '../lib/dom.js';
import { TodoAPI } from '../lib/api.js';
import { relativeDate, dateShort, timeAgo } from '../lib/format.js';
import { empty, skeleton, ring, progress, select } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { modal, confirmDialog } from '../ui/modal.js';

const PRIORITIES = [
  { value: 1, label: '高', cls: 'prio-1' },
  { value: 2, label: '中', cls: 'prio-2' },
  { value: 3, label: '低', cls: 'prio-3' },
];

export default async function todosView(host, ctx) {
  const state = { filter: 'open', project: '', q: '' };
  let data = { items: [], projects: [], stats: {} };

  const listNode = el('div.col', { style: { gap: '4px' } });
  const sideNode = el('div.col', { style: { gap: '16px' } });

  host.append(
    el('div.page-head', {}, [
      el('div.row-between.wrap', {}, [
        el('div', {}, [el('h1', {}, '待办清单'), el('p', {}, '把要做的事排好优先级，然后一件件划掉')]),
        el('div.row', {}, [
          el('button.btn.btn-ghost', { type: 'button', onclick: clearDone }, '🧹 清理已完成'),
          el('button.btn.btn-primary', { type: 'button', onclick: () => openEditor() }, '✚ 新建待办'),
        ]),
      ]),
    ]),
    el('div.grid.grid-sidebar', {}, [
      el('div.col', { style: { gap: '16px' } }, [
        el('div.card.pad-sm#todo-filters'),
        listNode,
      ]),
      sideNode,
    ]),
  );

  const filterBox = host.querySelector('#todo-filters');
  const searchInput = el('input.input', { type: 'search', 'aria-label': '搜索待办', placeholder: '搜索待办…' });
  searchInput.addEventListener('input', debounce(() => {
    state.q = searchInput.value.trim();
    load();
  }, 300));
  const filterRow = el('div.row.wrap', { style: { gap: '6px' } });
  filterBox.append(el('div.row.wrap', { style: { gap: '10px', marginBottom: '10px' } }, [searchInput]), filterRow);

  function renderFilters() {
    filterRow.replaceChildren();
    const items = [
      { value: 'open', label: '未完成' },
      { value: 'done', label: '已完成' },
      { value: 'all', label: '全部' },
      { value: 'overdue', label: '已逾期' },
    ];
    for (const f of items) {
      const btn = el(`button.chip${state.filter === f.value ? '.active' : ''}`, { type: 'button' }, f.label);
      btn.addEventListener('click', () => {
        state.filter = f.value;
        renderFilters();
        load();
      });
      filterRow.append(btn);
    }
  }
  renderFilters();

  async function load() {
    listNode.replaceChildren(skeleton(4));
    try {
      const params = {};
      if (state.filter === 'open') params.done = 'false';
      if (state.filter === 'done') params.done = 'true';
      if (state.project) params.project = state.project;
      if (state.q) params.q = state.q;
      data = await TodoAPI.list(params);
      renderList();
      renderSide();
    } catch (err) {
      listNode.replaceChildren(el('div.alert.alert-danger', {}, err.message));
    }
  }

  function renderList() {
    listNode.replaceChildren();
    let items = data.items;
    if (state.filter === 'overdue') items = items.filter((t) => t.overdue);

    if (!items.length) {
      listNode.append(
        empty(
          state.q ? '没有匹配的待办' : '这里空空如也',
          state.q ? '换个关键词试试' : '新建一条待办开始规划今天',
          el('button.btn.btn-primary', { type: 'button', onclick: () => openEditor() }, '新建待办'),
          '✅',
        ),
      );
      return;
    }

    const groups = new Map();
    for (const item of items) {
      const key = item.project || '未分组';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    for (const [project, list] of groups) {
      const section = el('div.card', {}, [
        el('div.row-between', { style: { marginBottom: '8px' } }, [
          el('div.row', {}, [
            el('strong', {}, project),
            el('span.badge', {}, `${list.filter((t) => t.done).length}/${list.length}`),
          ]),
          state.project === project
            ? el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { state.project = ''; load(); } }, '显示全部')
            : el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { state.project = project; load(); } }, '只看这个'),
        ]),
        el('div', {}, list.map(todoItem)),
      ]);
      listNode.append(section);
    }
  }

  function todoItem(todo) {
    const prio = PRIORITIES.find((p) => p.value === todo.priority) || PRIORITIES[1];
    const item = el(`div.todo${todo.done ? '.done' : ''}`, {}, [
      el('button.tick', { type: 'button', 'aria-label': todo.done ? '标记为未完成' : '标记为完成', onclick: () => toggle(todo) }),
      el('div.grow', { style: { minWidth: '0' } }, [
        el('div.t', {}, todo.title),
        (todo.detail || todo.dueAt || todo.priority !== 2)
          ? el('div.meta', {}, [
              todo.detail ? el('span.truncate', { style: { maxWidth: '260px' } }, todo.detail) : null,
              todo.dueAt
                ? el('span', { style: { color: todo.overdue ? 'var(--danger)' : '' } }, `📅 ${relativeDate(todo.dueAt)}`)
                : null,
              el(`span.${prio.cls}`, {}, `${prio.label}优先`),
            ])
          : null,
      ]),
      el('div.row', { style: { gap: '2px' } }, [
        el('button.icon-btn', { type: 'button', title: '编辑', onclick: () => openEditor(todo) }, '✏️'),
        el('button.icon-btn', { type: 'button', title: '删除', onclick: () => remove(todo) }, '🗑'),
      ]),
    ]);
    return item;
  }

  function renderSide() {
    const { stats, projects } = data;
    sideNode.replaceChildren(
      el('div.card', {}, [
        el('div.card-title', {}, '📊 完成情况'),
        el('div.row', { style: { gap: '16px' } }, [
          ring(stats.rate || 0, { size: 84 }),
          el('div.col', { style: { gap: '2px', fontSize: '0.85rem' } }, [
            el('div', {}, ['总任务 ', el('strong', {}, String(stats.total || 0))]),
            el('div.muted', {}, ['进行中 ', el('strong', {}, String(stats.open || 0))]),
            stats.overdue ? el('div', { style: { color: 'var(--danger)' } }, `逾期 ${stats.overdue}`) : null,
          ]),
        ]),
        el('div', { style: { marginTop: '12px' } }, progress(stats.rate || 0)),
      ]),
      projects.length
        ? el('div.card', {}, [
            el('div.card-title', {}, '📁 项目'),
            el('div.list', {}, projects.map((p) =>
              el('div.list-item', {}, [
                el('button.grow', {
                  type: 'button',
                  style: { textAlign: 'left', color: state.project === p.project ? 'var(--brand-text)' : 'var(--text-soft)' },
                  onclick: () => { state.project = state.project === p.project ? '' : p.project; load(); },
                }, p.project),
                el('span.badge', {}, `${p.done}/${p.total}`),
              ]),
            )),
          ])
        : null,
      el('div.card', {}, [
        el('div.card-title', {}, '⌨️ 快捷键'),
        el('div.col', { style: { gap: '6px', fontSize: '0.84rem' } }, [
          hint('N', '新建待办'),
          hint('/', '聚焦搜索'),
          hint('Enter', '勾选选中项'),
        ]),
      ]),
    );
  }

  function hint(key, text) {
    return el('div.row', {}, [el('kbd', {}, key), el('span.muted', {}, text)]);
  }

  async function toggle(todo) {
    try {
      await TodoAPI.toggle(todo.id);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function remove(todo) {
    if (!(await confirmDialog({ title: '删除待办', message: `确定删除「${todo.title}」？`, confirmText: '删除', danger: true }))) return;
    try {
      await TodoAPI.remove(todo.id);
      toast.success('已删除');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function clearDone() {
    if (!(await confirmDialog({ title: '清理已完成', message: '将删除全部已完成的待办，确定继续？', confirmText: '清理', danger: true }))) return;
    try {
      const res = await TodoAPI.clear();
      toast.success(`已清理 ${res.removed} 条`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  function openEditor(todo = null) {
    const titleInput = el('input.input', { 'aria-label': '待办标题', placeholder: '要做什么？', value: todo?.title || '' });
    const detailInput = el('textarea.textarea', { rows: 3, 'aria-label': '待办说明', placeholder: '补充说明（可选）' });
    detailInput.value = todo?.detail || '';
    const prioritySelect = select(PRIORITIES.map((p) => ({ value: p.value, label: p.label })));
    prioritySelect.value = todo?.priority || 2;
    const projectInput = el('input.input', { 'aria-label': '所属项目', placeholder: '例如：工作 / 生活', value: todo?.project || '', list: 'project-list' });
    const dueInput = el('input.input', { type: 'date', value: todo?.dueAt ? todo.dueAt.slice(0, 10) : '' });

    const datalist = el('datalist', { id: 'project-list' }, data.projects.map((p) => el('option', { value: p.project })));

    const body = el('form', { onsubmit: (e) => e.preventDefault() }, [
      el('div.field', {}, [el('label', {}, '任务'), titleInput]),
      el('div.field', {}, [el('label', {}, '详情'), detailInput]),
      el('div.grid.grid-2', { style: { gap: '12px' } }, [
        el('div.field', {}, [el('label', {}, '优先级'), prioritySelect]),
        el('div.field', {}, [el('label', {}, '截止日期'), dueInput]),
      ]),
      el('div.field', {}, [el('label', {}, '项目'), projectInput, datalist]),
    ]);

    const saveBtn = el('button.btn.btn-primary', { type: 'button' }, todo ? '保存' : '添加');
    const dlg = modal({ title: todo ? '编辑待办' : '新建待办', body, footer: [saveBtn] });

    saveBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) return toast.warning('请填写任务内容');
      const payload = {
        title,
        detail: detailInput.value.trim(),
        priority: Number(prioritySelect.value),
        project: projectInput.value.trim() || null,
        dueAt: dueInput.value ? new Date(`${dueInput.value}T23:59:59`).toISOString() : null,
      };
      saveBtn.setAttribute('aria-busy', 'true');
      try {
        if (todo) await TodoAPI.update(todo.id, payload);
        else await TodoAPI.create(payload);
        dlg.close();
        toast.success(todo ? '已保存' : '待办已添加');
        load();
      } catch (err) {
        toast.error(err.message);
        saveBtn.removeAttribute('aria-busy');
      }
    });
  }

  /* 快捷键 */
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (typing) return;
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openEditor();
    } else if (e.key === '/') {
      e.preventDefault();
      searchInput.focus();
    }
  });

  await load();
  if (ctx.query.new) openEditor();
}
