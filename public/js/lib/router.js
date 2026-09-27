/** hash 路由：支持 /blog/slug?page=2 形式 */
import { emit } from './store.js';
import { scrollTop } from './dom.js';

const routes = [];
let notFoundHandler = null;
let current = null;
let started = false;

function normalize(hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return {
    path: path.startsWith('/') ? path : `/${path}`,
    query: Object.fromEntries(new URLSearchParams(search).entries()),
    search,
  };
}

function match(path) {
  const clean = path.replace(/\/+$/, '') || '/';
  for (const route of routes) {
    const keys = [];
    const pattern = route.path
      .split('/')
      .map((seg) => {
        if (seg === '*') {
          keys.push('wildcard');
          return '(.*)';
        }
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    const re = new RegExp(`^${pattern}/?$`);
    const m = re.exec(clean);
    if (!m) continue;
    const params = {};
    keys.forEach((k, i) => {
      params[k] = decodeURIComponent(m[i + 1] ?? '');
    });
    return { route, params };
  }
  return null;
}

export function route(path, view, meta = {}) {
  routes.push({ path, view, meta });
}

export function fallback(view) {
  notFoundHandler = view;
}

export function currentRoute() {
  return current;
}

/** 上一个视图返回的清理函数（关闭连接、清定时器、摘监听） */
let disposeCurrent = null;

function runDispose() {
  const fn = disposeCurrent;
  disposeCurrent = null;
  if (typeof fn === 'function') {
    try {
      fn();
    } catch (err) {
      console.error('[router] 视图清理失败', err);
    }
  }
}

async function render() {
  const { path, query, search } = normalize(location.hash);
  const found = match(path);
  const view = found?.route.view || notFoundHandler;
  if (!view) return;

  // 切换视图前先拆掉上一个，避免 WebSocket / 定时器 / 监听泄漏
  runDispose();

  const ctx = { path, query, search, params: found?.params || {}, meta: found?.route.meta || {} };
  current = ctx;
  emit('route:start', ctx);

  try {
    const dispose = await view(ctx);
    if (typeof dispose === 'function') disposeCurrent = dispose;
  } catch (err) {
    console.error('[router] 渲染失败', err);
    if (err.status === 401) {
      location.hash = `#/login?next=${encodeURIComponent(path)}`;
    } else {
      emit('route:error', { err, ctx });
    }
  }
  emit('route:end', ctx);
  if (!ctx.meta.keepScroll) scrollTop(false);
}

export function go(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (replace) location.replace(target);
  else location.hash = target;
}

export function start() {
  if (started) return;
  started = true;
  window.addEventListener('hashchange', render);
  if (!location.hash) location.replace('#/');
  render();
}

export function refresh() {
  return render();
}
