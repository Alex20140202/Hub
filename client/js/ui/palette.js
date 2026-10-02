import { el } from '../lib/dom.js';
import { openModal, closeModal } from './modal.js';
import { api } from '../lib/api.js';

const NAV_ITEMS = [
  { label: '仪表盘', href: '/', key: 'G D' },
  { label: '笔记', href: '/notes', key: 'G N' },
  { label: '待办', href: '/todos', key: 'G T' },
  { label: '书签', href: '/links', key: 'G L' },
  { label: '文件', href: '/files', key: 'G F' },
  { label: '搜索', href: '/search', key: '/' },
  { label: '设置', href: '/settings', key: 'G S' },
];

const COMMANDS = [
  { label: '新建笔记', hint: 'N', run: () => location.assign('/notes?new=1') },
  { label: '新建待办', hint: 'T', run: () => location.assign('/todos?new=1') },
  { label: '新建书签', hint: 'B', run: () => location.assign('/links?new=1') },
  { label: '切换明暗主题', hint: '⇧D', run: () => document.dispatchEvent(new CustomEvent('hub:toggle-theme')) },
  { label: '上传文件', hint: 'U', run: () => location.assign('/files?upload=1') },
];

/** ⌘K / Ctrl+K 命令面板：导航 + 指令 + 站内搜索。 */
export function openPalette() {
  const results = el('div', { class: 'palette-list' });
  const input = el('input', {
    class: 'palette-input',
    type: 'search',
    placeholder: '跳转页面、执行指令或搜索内容…',
    'aria-label': '命令面板',
    autocomplete: 'off',
  });
  const panel = el('div', { class: 'palette' }, [input, results]);
  const wrap = el('div', { class: 'modal' }, [panel]);

  let items = [];
  let active = 0;

  const render = () => {
    results.replaceChildren();
    if (!items.length) {
      results.append(el('p', { class: 'hint', style: 'padding:16px' }, ['没有匹配项']));
      return;
    }
    items.forEach((item, index) => {
      const node = el(
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
        [item.icon ? el('span', {}, [item.icon]) : null, el('span', {}, [item.label]), item.hint ? el('kbd', {}, [item.hint]) : null],
      );
      results.append(node);
    });
  };

  const move = (delta) => {
    if (!items.length) return;
    active = (active + delta + items.length) % items.length;
    render();
    results.children[active]?.scrollIntoView({ block: 'nearest' });
  };

  const choose = (item) => {
    closeModal();
    if (item.href) location.assign(item.href);
    else item.run?.();
  };

  const base = () => [
    { label: '页面', items: NAV_ITEMS.map((entry) => ({ label: entry.label, href: entry.href, hint: entry.key })) },
    { label: '指令', items: COMMANDS },
  ];

  const searchLocal = (term) => {
    const groups = base();
    const matched = groups
      .map((group) => ({ label: group.label, items: group.items.filter((item) => item.label.includes(term)) }))
      .filter((group) => group.items.length);
    return matched.flatMap((group) => [{ group: group.label }, ...group.items]);
  };

  let searchTimer;
  input.addEventListener('input', () => {
    const term = input.value.trim();
    if (!term) {
      items = searchLocal('');
      active = 0;
      return render();
    }
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      items = searchLocal(term).filter((entry) => entry.label);
      active = 0;
      render();
      try {
        const result = await api.get(`/api/search?q=${encodeURIComponent(term)}`);
        const remote = result.groups
          .flatMap((group) => group.items)
          .slice(0, 8)
          .map((item) => ({ label: item.title || '(无标题)', href: item.href, hint: groupLabel(result.groups, item) }));
        if (remote.length) {
          items.push({ group: '内容' }, ...remote);
          render();
        }
      } catch {
        /* 搜索失败时静默，仅展示本地匹配 */
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
      if (items[active] && items[active].label) choose(items[active]);
    }
  });

  items = searchLocal('');
  render();

  const host = document.getElementById('modal-host');
  if (!host) return;
  const backdrop = el('div', { class: 'modal-backdrop' });
  host.replaceChildren(backdrop, wrap);
  host.hidden = false;
  document.body.style.overflow = 'hidden';
  input.focus();

  const cleanup = () => {
    document.removeEventListener('keydown', onKey, true);
    document.body.style.removeProperty('overflow');
    closeModal();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cleanup();
    }
  };
  backdrop.addEventListener('click', cleanup);
  document.addEventListener('keydown', onKey, true);
}

const groupLabel = (groups, item) => groups.find((group) => group.items.includes(item))?.type ?? '';

export const installPalette = () => {
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
    }
  });
};
