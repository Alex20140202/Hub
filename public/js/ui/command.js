import { el, debounce } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { go } from '../lib/router.js';
import { PublicAPI } from '../lib/api.js';

const COMMANDS = [
  { label: '首页', hint: '概览与精选', icon: '🏠', run: () => go('/') },
  { label: '博客列表', hint: '全部文章', icon: '📝', run: () => go('/blog') },
  { label: '写新文章', hint: 'Markdown 编辑器', icon: '✍️', run: () => go('/blog/new'), auth: true },
  { label: '工作台', hint: '数据仪表盘', icon: '📊', run: () => go('/dashboard'), auth: true },
  { label: '我的笔记', hint: '速记与备忘', icon: '📓', run: () => go('/notes'), auth: true },
  { label: '待办清单', hint: '任务管理', icon: '✅', run: () => go('/todos'), auth: true },
  { label: '书签收藏', hint: '链接管理', icon: '🔖', run: () => go('/links'), auth: true },
  { label: '文件与图床', hint: '上传与管理', icon: '📁', run: () => go('/files') },
  { label: '短链生成', hint: 'URL 缩短', icon: '🔗', run: () => go('/short') },
  { label: '实时聊天室', hint: 'WebSocket', icon: '💬', run: () => go('/chat') },
  { label: '搜索', hint: '全站检索', icon: '🔍', run: () => go('/search') },
  { label: '设置', hint: '账号与外观', icon: '⚙️', run: () => go('/settings'), auth: true },
  { label: '管理后台', hint: '仅管理员', icon: '🛡', run: () => go('/admin'), admin: true },
  { label: '切换主题', hint: '亮色 / 暗色', icon: '🌗', run: () => document.getElementById('theme-toggle')?.click() },
];

let overlay = null;

export function closeCommand() {
  overlay?.remove();
  overlay = null;
}

export function openCommand(initial = '') {
  if (overlay) {
    closeCommand();
    return;
  }
  const root = document.getElementById('command-root');
  const input = el('input', {
    type: 'text',
    placeholder: '搜索文章、用户，或输入命令…',
    value: initial,
    'aria-label': '命令面板',
  });
  const list = el('div.cmdk-list');
  const box = el('div.cmdk', {}, [
    input,
    list,
    el('div.cmdk-foot', {}, [
      el('span', {}, '↑↓ 选择'),
      el('span', {}, '↵ 执行'),
      el('span', {}, 'Esc 关闭'),
    ]),
  ]);
  overlay = el('div.cmdk-backdrop', {}, box);

  let items = [];
  let sel = 0;
  let searchTimer;

  const visible = (cmd) => {
    if (cmd.auth && !store.user) return false;
    if (cmd.admin && store.user?.role !== 'admin') return false;
    return true;
  };

  const renderList = (keyword = '') => {
    const q = keyword.trim().toLowerCase();
    items = COMMANDS.filter((c) => visible(c) && (!q || c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q)));
    if (q) {
      items = [
        ...items,
        {
          label: `搜索「${keyword}」`,
          hint: '在站内检索',
          icon: '🔍',
          run: () => go(`/search?q=${encodeURIComponent(keyword)}`),
        },
      ];
    }
    sel = 0;
    draw();
  };

  const draw = () => {
    list.replaceChildren();
    if (!items.length) {
      list.append(el('div.empty', { style: { padding: '24px' } }, el('p', {}, '没有匹配的命令')));
      return;
    }
    items.forEach((cmd, i) => {
      list.append(
        el(`button.cmdk-item${i === sel ? '.sel' : ''}`, {
          type: 'button',
          onclick: () => execute(i),
        }, [
          el('span', {}, cmd.icon),
          el('span.grow', {}, cmd.label),
          cmd.hint ? el('span.small.muted', {}, cmd.hint) : null,
        ]),
      );
    });
  };

  const execute = (i) => {
    const cmd = items[i];
    if (!cmd) return;
    closeCommand();
    cmd.run();
  };

  input.addEventListener('input', debounce(() => renderList(input.value), 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = (sel + 1) % items.length;
      draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel - 1 + items.length) % items.length;
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      execute(sel);
    } else if (e.key === 'Escape') {
      closeCommand();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeCommand();
  });

  const onDocKey = (e) => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onDocKey);
      closeCommand();
    }
  };
  document.addEventListener('keydown', onDocKey);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(overlay)) {
      observer.disconnect();
      document.removeEventListener('keydown', onDocKey);
    }
  });
  observer.observe(document.getElementById('command-root'), { childList: true });

  root.append(overlay);
  renderList(initial);
  setTimeout(() => input.focus(), 30);
}
