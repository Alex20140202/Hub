import { escapeHtml, icon, initials, jsonScript } from './html.js';

const NAV = [
  { group: '总览', items: [
    { href: '/', label: '首页', icon: 'home', auth: true },
    { href: '/blog', label: '博客', icon: 'blog', auth: false },
    { href: '/search', label: '搜索', icon: 'search', auth: true },
  ] },
  { group: '工作台', items: [
    { href: '/notes', label: '笔记', icon: 'notes', auth: true },
    { href: '/todos', label: '待办', icon: 'todos', auth: true },
    { href: '/links', label: '书签', icon: 'links', auth: true },
    { href: '/files', label: '文件', icon: 'files', auth: true },
    { href: '/short', label: '短链', icon: 'short', auth: true },
  ] },
  { group: '社区', items: [
    { href: '/chat', label: '聊天室', icon: 'chat', auth: false },
    { href: '/points', label: '积分中心', icon: 'points', auth: true },
    { href: '/settings', label: '设置', icon: 'settings', auth: true },
    { href: '/admin', label: '管理后台', icon: 'admin', auth: 'admin' },
  ] },
];

const FLAT_NAV = NAV.flatMap((section) => section.items);

const titleOf = (pathname) => {
  if (pathname === '/') return '首页';
  const item = FLAT_NAV.find((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`));
  if (item) return item.label;
  if (pathname.startsWith('/u/')) return '用户主页';
  if (pathname.startsWith('/d/')) return '文件分享';
  if (pathname.startsWith('/s/')) return '短链跳转';
  return '页面';
};

const isActive = (entry, pathname) =>
  entry.href === '/' ? pathname === '/' : pathname === entry.href || pathname.startsWith(`${entry.href}/`);

/**
 * 应用外壳：侧边导航 + 顶栏 + 主内容区。
 * 服务端渲染完整结构，客户端 JS 负责接管交互与局部更新。
 */
export function renderLayout({ title, description, pathname, user, content, assets, settings, initialState }) {
  const visible = (item) => {
    if (!item.auth) return true;
    if (!user) return false;
    return item.auth !== 'admin' || user.role === 'admin';
  };

  const nav = NAV.map((section) => {
    const items = section.items.filter(visible);
    if (!items.length) return '';
    return `<div class="nav-group">
      <span class="nav-group-label">${escapeHtml(section.group)}</span>
      ${items
        .map(
          (entry) => `<a class="nav-link${isActive(entry, pathname) ? ' is-active' : ''}" href="${entry.href}"${
            isActive(entry, pathname) ? ' aria-current="page"' : ''
          }>${icon(entry.icon)}<span>${entry.label}</span>${
            entry.href === '/points' && user?.points ? `<em class="nav-badge">${user.points > 999 ? '999+' : user.points}</em>` : ''
          }</a>`,
        )
        .join('')}
    </div>`;
  }).join('');

  const theme = user?.theme ?? 'auto';
  const accent = user?.accent ?? 'indigo';

  return `<!doctype html>
<html lang="zh-CN" data-theme="${escapeHtml(theme)}" data-accent="${escapeHtml(accent)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title ? `${title} · ${settings.site_name}` : settings.site_name)}</title>
<meta name="description" content="${escapeHtml(description || settings.site_tagline)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/app.css?v=${assets.css}">
<script>
  // 主题在样式应用前同步落定，避免首屏闪白
  (function () {
    try {
      var t = localStorage.getItem('hub.theme') || '${escapeHtml(theme)}';
      if (t === 'auto') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = t;
      var a = localStorage.getItem('hub.accent');
      if (a) document.documentElement.dataset.accent = a;
    } catch (e) {}
  })();
</script>
</head>
<body data-site-name="${escapeHtml(settings.site_name)}">
<a class="skip-link" href="#main">跳到主要内容</a>
<div class="app" id="app">
  ${user ? sidebar({ user, nav, pathname }) : ''}
  <div class="app-main">
    ${user ? topbar({ user, pathname, title: titleOf(pathname) }) : ''}
    <main class="page" id="main" tabindex="-1">${content}</main>
    ${user ? `<footer class="site-foot"><span>${escapeHtml(settings.site_name)}</span><span>Node.js 双端 · 零依赖</span></footer>` : ''}
  </div>
</div>
${user ? `<button class="fab" type="button" data-action="quick-add" aria-label="新建">${icon('plus', 22)}</button>` : ''}
<div class="toast-host" id="toast-host" role="status" aria-live="polite"></div>
<div class="modal-host" id="modal-host" hidden></div>
<script type="application/json" id="hub-state">${jsonScript({ ...initialState, user, pathname })}</script>
<script type="module" src="/assets/app.js?v=${assets.js}"></script>
</body>
</html>`;
}

function sidebar({ user, nav, pathname }) {
  return `<aside class="sidebar" id="sidebar">
  <a class="brand" href="/">
    <span class="brand-mark" aria-hidden="true">H</span>
    <span class="brand-text"><strong>Hub</strong><em>超级中心</em></span>
  </a>
  <nav class="nav" aria-label="主导航">${nav}</nav>
  <div class="sidebar-foot">
    <a class="user-chip" href="/settings">
      <span class="avatar" style="--hue:${Number(user.avatarHue) || 210}">${escapeHtml(initials(user.nickname))}</span>
      <span class="user-chip-text">
        <strong>${escapeHtml(user.nickname)}</strong>
        <em>@${escapeHtml(user.username)}</em>
      </span>
    </a>
    <button class="icon-btn" type="button" data-action="logout" title="退出登录" aria-label="退出登录">${icon('logout')}</button>
  </div>
</aside>`;
}

function topbar({ user, title }) {
  return `<header class="topbar">
  <button class="icon-btn only-mobile" type="button" data-action="toggle-nav" aria-label="打开导航">${icon('menu')}</button>
  <h1 class="page-title">${escapeHtml(title)}</h1>
  <div class="topbar-actions">
    <button class="search-trigger" type="button" data-action="open-search">
      ${icon('search', 16)}<span>搜索…</span><kbd>⌘K</kbd>
    </button>
    <button class="icon-btn" type="button" data-action="toggle-theme" title="切换明暗模式" aria-label="切换明暗模式">${icon('moon')}</button>
  </div>
</header>`;
}

/** 未登录时的营销页外壳。 */
export function renderGuestLayout({ settings, content, assets, pathname, initialState }) {
  return `<!doctype html>
<html lang="zh-CN" data-theme="auto" data-accent="indigo">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(settings.site_name)}</title>
<meta name="description" content="${escapeHtml(settings.site_tagline)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/app.css?v=${assets.css}">
<script>
  (function () {
    try {
      var t = localStorage.getItem('hub.theme') || 'auto';
      if (t === 'auto') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = t;
    } catch (e) {}
  })();
</script>
</head>
<body class="is-guest">
<main class="guest" id="main">${content}</main>
<script type="application/json" id="hub-state">${jsonScript({ ...initialState, user: null, pathname })}</script>
<script type="module" src="/assets/app.js?v=${assets.js}"></script>
</body>
</html>`;
}
