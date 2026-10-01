import { hydrate, store, on, toggleTheme } from './lib/store.js';
import { route, fallback, start, go } from './lib/router.js';
import { el, clear, $ } from './lib/dom.js';
import { toast } from './ui/toast.js';
import { avatar, avatarFramed } from './ui/components.js';
import { openCommand } from './ui/command.js';
import { openAuthMenu } from './ui/user-menu.js';

import home from './views/home.js';
import login from './views/login.js';
import register from './views/register.js';
import blog from './views/blog.js';
import post from './views/post.js';
import editor from './views/editor.js';
import dashboard from './views/dashboard.js';
import notes from './views/notes.js';
import todos from './views/todos.js';
import links from './views/links.js';
import files from './views/files.js';
import chat from './views/chat.js';
import short from './views/short.js';
import profile from './views/profile.js';
import userProfile from './views/user.js';
import search from './views/search.js';
import admin from './views/admin.js';
import settings from './views/settings.js';
import points from './views/points.js';
import notFound from './views/not-found.js';

const outlet = () => document.getElementById('main');

/** 视图包装：统一处理鉴权、页面容器与错误兜底 */
function view(render, { auth = false, admin = false, title = null } = {}) {
  return async (ctx) => {
    if (auth && !store.user) {
      go(`/login?next=${encodeURIComponent(ctx.path)}`, { replace: true });
      return;
    }
    if (admin && store.user?.role !== 'admin') {
      toast.error('该页面需要管理员权限');
      go('/', { replace: true });
      return;
    }
    if (title) {
      const base = store.settings.site_name || 'Hub';
      document.title = typeof title === 'function' ? `${title(ctx)} · ${base}` : `${title} · ${base}`;
    }
    const host = el('div.page.view-enter');
    clear(outlet()).append(host);
    try {
      // 视图可以返回一个清理函数，路由切换时自动调用
      return await render(host, ctx);
    } catch (err) {
      if (err.status === 401) {
        go(`/login?next=${encodeURIComponent(ctx.path)}`, { replace: true });
        return;
      }
      console.error('[view]', err);
      host.append(
        el('div.empty', {}, [
          el('div.icon', {}, '⚠️'),
          el('h3', {}, '页面加载失败'),
          el('p', {}, err.message || '未知错误'),
          el('button.btn.btn-primary', { style: { marginTop: '16px' }, onclick: () => location.reload() }, '重新加载'),
        ]),
      );
    }
  };
}

/* ================= 路由表 ================= */
const NAV = [
  { path: '/', label: '首页', view: home, public: true },
  { path: '/blog', label: '博客', view: blog, public: true },
  { path: '/notes', label: '笔记', view: notes },
  { path: '/todos', label: '待办', view: todos },
  { path: '/links', label: '书签', view: links },
  { path: '/files', label: '文件', view: files },
  { path: '/points', label: '积分', view: points },
  { path: '/chat', label: '聊天室', view: chat, public: true },
  { path: '/short', label: '短链', view: short, public: true },
];

for (const item of NAV) {
  route(item.path, view(item.view, { title: item.label }), { nav: item, public: item.public });
}

route('/dashboard', view(dashboard, { auth: true, title: '工作台' }), { nav: { path: '/dashboard', label: '工作台' } });
route('/login', view(login, { title: '登录', bare: true }), { public: true, bare: true });
route('/register', view(register, { title: '注册', bare: true }), { public: true, bare: true });
route('/blog/new', view(editor, { auth: true, title: '写文章' }), { auth: true });
route('/blog/:slug/edit', view(editor, { auth: true, title: '编辑文章' }), { auth: true });
route('/blog/:slug', view(post, { title: (c) => c.params.slug }), { public: true });
route('/profile', view(profile, { auth: true, title: '个人中心' }), { auth: true });
route('/u/:username', view(userProfile, { title: '用户主页' }), { public: true });
route('/search', view(search, { title: '搜索' }), { public: true });
route('/admin', view(admin, { auth: true, admin: true, title: '管理后台' }), { auth: true });
route('/settings', view(settings, { auth: true, title: '设置' }), { auth: true });
fallback(view(notFound, { title: '页面不存在' }));

/* ================= 导航与外壳 ================= */
function renderNav() {
  const nav = $('#main-nav');
  if (!nav) return;
  const current = (location.hash.replace(/^#/, '').split('?')[0] || '/');
  const items = NAV.filter((n) => n.public || store.user);
  clear(nav);
  for (const item of items) {
    const active = current === item.path || (item.path !== '/' && current.startsWith(item.path));
    nav.append(el(`a${active ? '.active' : ''}`, { href: `#${item.path}` }, item.label));
  }
  if (store.user?.role === 'admin') {
    nav.append(el(`a${current.startsWith('/admin') ? '.active' : ''}`, { href: '#/admin' }, '管理'));
  }
  renderAuthSlot();
}

function renderAuthSlot() {
  const slot = $('#auth-slot');
  if (!slot) return;
  clear(slot);
  if (store.user) {
    const trigger = el('button.user-trigger', { type: 'button', 'aria-haspopup': 'menu' }, [
      avatarFramed(store.user, 'sm'),
      el('span.small.nowrap.hide-sm', {}, store.user.nickname || store.user.username),
      el('span.muted.small', {}, '▾'),
    ]);
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      openAuthMenu(trigger);
    });
    slot.append(trigger);
  } else {
    slot.append(
      el('a.btn.btn-ghost.btn-sm', { href: '#/login' }, '登录'),
      el('a.btn.btn-primary.btn-sm', { href: '#/register' }, '注册'),
    );
  }
}

function renderShell() {
  $('#app-header').hidden = false;
  $('.app-footer').hidden = false;
  const name = store.settings.site_name || 'Hub';
  document.title = `${name} · ${store.settings.site_tagline || '全栈综合站点'}`;
  $('.brand-text').textContent = name;
  const tagline = $('#footer-tagline');
  if (tagline) tagline.textContent = store.settings.site_tagline || '';
  const footerText = $('#footer-text');
  if (footerText) footerText.textContent = store.settings.footer_text || '';

  const links = $('#footer-links');
  clear(links);
  for (const [href, label] of [
    ['/', '首页'],
    ['/blog', '博客'],
    ['/chat', '聊天室'],
    ['/short', '短链工具'],
    store.user ? ['/settings', '设置'] : ['/login', '登录'],
  ]) {
    links.append(el('a', { href: `#${href}` }, label));
  }
  if (store.settings.icp) {
    links.append(el('a', { href: 'https://beian.miit.gov.cn', target: '_blank', rel: 'noopener' }, store.settings.icp));
  }
}

function setupChrome() {
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#search-btn').addEventListener('click', () => openCommand());

  const navToggle = $('#nav-toggle');
  const nav = $('#main-nav');
  navToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') {
      nav.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommand();
    } else if (e.key === '/' && !typing) {
      e.preventDefault();
      openCommand();
    }
  });

  window.addEventListener('hashchange', renderNav);
  on('user', renderNav);
  on('network', (online) => {
    if (!online) toast.warning('网络已断开，实时功能可能不可用');
  });
}

/* ================= 启动 ================= */
async function boot() {
  try {
    await hydrate();
  } catch (err) {
    console.error('[boot]', err);
    toast.error(`初始化失败：${err.message}`);
  }

  setupChrome();
  renderShell();
  renderNav();
  if (!location.hash) location.replace('#/');
  start();

  const splash = document.getElementById('boot');
  splash.classList.add('done');
  setTimeout(() => splash.remove(), 400);
}

boot();
