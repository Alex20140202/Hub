import { el } from '../lib/dom.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { api } from '../lib/api.js';

const NAV_ITEMS = [
  { label: '仪表盘', href: '/', key: 'G D' },
  { label: '博客', href: '/blog', key: 'G N' },
  { label: '待办', href: '/todos', key: 'G T' },
  { label: '书签', href: '/links', key: 'G L' },
  { label: '文件', href: '/files', key: 'G F' },
  { label: '积分中心', href: '/points', key: 'G P' },
  { label: '聊天室', href: '/chat', key: 'G C' },
  { label: '搜索页', href: '/search', key: '/' },
  { label: '设置', href: '/settings', key: 'G S' },
];

const COMMANDS = [
  { label: '新建笔记', hint: 'N', run: () => location.assign('/notes?new=1') },
  { label: '新建待办', hint: 'T', run: () => location.assign('/todos?new=1') },
  { label: '新建书签', hint: 'B', run: () => location.assign('/links?new=1') },
  { label: '新建文章', hint: 'P', run: () => location.assign('/blog/new') },
  { label: '创建短链', hint: 'L', run: () => location.assign('/short?new=1') },
  { label: '上传文件', hint: 'U', run: () => location.assign('/files?upload=1') },
  { label: '切换明暗主题', hint: '⇧D', run: () => document.dispatchEvent(new CustomEvent('hub:toggle-theme')) },
];

// 与 server/models/search.js 返回的分组类型对应
const SCOPES = [
  { type: 'note', label: '笔记' },
  { type: 'todo', label: '待办' },
  { type: 'link', label: '书签' },
  { type: 'file', label: '文件' },
];

/**
 * ⌘K / Ctrl+K / `/` 命令面板。
 *
 * 刻意复用 modal.js 的 openModal：Esc、遮罩点击、焦点陷阱、body 滚动锁
 * 都由同一套生命周期处理。之前这里自己往 #modal-host 塞 DOM，
 * 关闭时调用的 closeModal() 找不到对应实例，导致面板退不出去。
 */
export function openPalette() {
  const results = el('div', { class: 'palette-list' });
  const input = el('input', {
    class: 'palette-input',
    type: 'search',
    placeholder: '跳转页面、执行指令或搜索内容…',
    'aria-label': '命令面板',
    autocomplete: 'off',
  });

  let items = [];
  let active = 0;
  let searchTimer = null;

  const render = () => {
    results.replaceChildren();
    if (!items.length) {
      results.append(el('p', { class: 'hint', style: 'padding:16px' }, ['没有匹配项']));
      return;
    }

    let lastGroup = '';
    items.forEach((item, index) => {
      if (item.group && item.group !== lastGroup) {
        lastGroup = item.group;
        results.append(el('div', { class: 'palette-group' }, [item.group]));
      }
      results.append(
        el(
          'button',
          {
            class: `palette-item${index === active ? ' is-active' : ''}`,
            type: 'button',
            onClick: () => choose(item),
            onMouseenter: () => {
              active = index;
              render();
            },
          },
          [
            el('span', {}, [item.label]),
            item.hint ? el('kbd', {}, [item.hint]) : null,
          ],
        ),
      );
    });
  };

  const move = (delta) => {
    if (!items.length) return;
    active = (active + delta + items.length) % items.length;
    render();
    results.children[active]?.scrollIntoView({ block: 'nearest' });
  };

  const choose = (item) => {
    if (!item || item.group) return;
    close();
    if (item.href) location.assign(item.href);
    else item.run?.();
  };

  const base = () => [
    { group: '页面' },
    ...NAV_ITEMS.map((entry) => ({ label: entry.label, href: entry.href, hint: entry.key })),
    { group: '指令' },
    ...COMMANDS.map((entry) => ({ label: entry.label, hint: entry.hint, run: entry.run })),
  ];

  const local = (term) =>
    base().filter((entry) => entry.group || entry.label.toLowerCase().includes(term.toLowerCase()));

  input.addEventListener('input', () => {
    const term = input.value.trim();
    if (!term) {
      items = local('');
      active = 0;
      return render();
    }

    items = local(term).filter((entry) => !entry.group);
    active = 0;
    render();

    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      try {
        const result = await api.get(`/api/search?q=${encodeURIComponent(term)}&scope=all`);
        const hits = result.groups.flatMap((group) => group.items).slice(0, 8);
        if (!hits.length) return;
        items = [...items, { group: '内容' }, ...hits.map((item) => ({ label: item.title || '(无标题)', href: item.href, hint: groupName(result.groups, item) }))];
        render();
      } catch {
        /* 搜索失败时保持本地匹配即可 */
      }
    }, 220);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === 'Escape') {
      // 交给 modal.js 统一处理，这里只阻止冒泡避免重复触发
      event.preventDefault();
    }
  });

  items = local('');
  render();

  let close = () => {};
  openModal({
    className: 'palette',
    width: 560,
    build: ({ close: closeModal, body }) => {
      close = closeModal;
      body.classList.add('palette-body');
      body.append(input, results);
      input.focus();
      return {};
    },
  });

  return { close: () => close() };
}

const groupName = (groups, item) => {
  const group = groups.find((entry) => entry.items.includes(item));
  return SCOPES.find((scope) => scope.type === group?.type)?.label ?? '';
};

/** 全局快捷键注册。 */
export const installPalette = () => {
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
    }
  });
};