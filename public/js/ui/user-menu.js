import { el, clear, $, on } from '../lib/dom.js';
import { store, logout, isAdmin } from '../lib/store.js';
import { go } from '../lib/router.js';
import { toast } from './toast.js';

let currentMenu = null;

document.addEventListener('click', () => closeMenu(), true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});
window.addEventListener('hashchange', () => closeMenu());

function closeMenu() {
  currentMenu?.remove();
  currentMenu = null;
}

export function openAuthMenu(anchor) {
  closeMenu();
  if (!store.user) return;

  const item = (label, href, icon) =>
    el('a', { href }, [el('span', {}, icon), el('span', {}, label)]);

  const menu = el('div.menu-pop', { role: 'menu' }, [
    el('div', { style: { padding: '8px 10px 10px', borderBottom: '1px solid var(--border)', marginBottom: '4px' } }, [
      el('div', { style: { fontWeight: '700' } }, store.user.nickname || store.user.username),
      el('div.small.muted.truncate', {}, `@${store.user.username}`),
    ]),
    item('工作台', '#/dashboard', '📊'),
    item('个人主页', `#/u/${store.user.username}`, '👤'),
    item('设置', '#/settings', '⚙️'),
    isAdmin() ? item('管理后台', '#/admin', '🛡') : null,
    el('div.divider'),
    el('a', { href: '#/blog/new' }, [el('span', {}, '✍️'), el('span', {}, '写文章')]),
    el('button', {
      type: 'button',
      class: 'danger',
      onclick: async () => {
        closeMenu();
        await logout();
        toast.success('已退出登录');
        go('/');
      },
    }, [el('span', {}, '🚪'), el('span', {}, '退出登录')]),
  ]);

  anchor.parentElement.append(menu);
  currentMenu = menu;

  // 点击菜单内部不关闭
  menu.addEventListener('click', (e) => e.stopPropagation());

  on('user', () => closeMenu());
}
