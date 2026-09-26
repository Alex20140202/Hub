/** 应用状态：用户、主题、站点设置、轻量事件总线 */
import { AuthAPI, token } from './api.js';

const listeners = new Map();

export const store = {
  user: null,
  settings: {
    site_name: 'Hub',
    site_tagline: 'Node.js 全栈综合站点',
    site_description: '',
    icp: '',
    footer_text: '由 Node.js 驱动 · 零第三方依赖',
    allow_registration: true,
  },
  theme: localStorage.getItem('hub.theme') || 'system',
  online: true,
  hydrated: false,
};

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event).delete(handler);
}

export function emit(event, payload) {
  for (const handler of listeners.get(event) || []) {
    try {
      handler(payload);
    } catch (err) {
      console.error('[store] listener error', event, err);
    }
  }
  for (const handler of listeners.get('*') || []) {
    try {
      handler({ event, payload });
    } catch {
      /* ignore */
    }
  }
}

/* ---------- 主题 ---------- */
export function applyTheme(theme) {
  store.theme = theme;
  localStorage.setItem('hub.theme', theme);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#080b14' : '#6366f1';
  emit('theme', store.theme);
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (store.theme === 'system') applyTheme('system');
});

/* ---------- 会话 ---------- */
export async function hydrate() {
  try {
    const { user } = await AuthAPI.me();
    store.user = user || null;
  } catch {
    store.user = null;
  }
  try {
    const { settings } = await AuthAPI.settings();
    Object.assign(store.settings, settings);
  } catch {
    /* 设置读取失败不影响主流程 */
  }
  store.hydrated = true;
  if (store.user?.theme) applyTheme(store.user.theme);
  emit('user', store.user);
  emit('settings', store.settings);
  return store.user;
}

export async function login(login_, password) {
  const { user, token: t } = await AuthAPI.login(login_, password);
  token.set(t);
  store.user = user;
  emit('user', user);
  return user;
}

export async function register(data) {
  const { user, token: t } = await AuthAPI.register(data);
  token.set(t);
  store.user = user;
  emit('user', user);
  return user;
}

export async function logout() {
  try {
    await AuthAPI.logout();
  } catch {
    /* 忽略网络错误，前端仍然清空 */
  }
  token.set('');
  store.user = null;
  emit('user', null);
}

export const isLoggedIn = () => !!store.user;
export const isAdmin = () => store.user?.role === 'admin';

export function requireLogin(next) {
  if (isLoggedIn()) return true;
  location.hash = `#/login?next=${encodeURIComponent(next || location.hash.slice(1) || '/')}`;
  return false;
}

window.addEventListener('hub:unauthorized', () => {
  if (store.user) {
    store.user = null;
    emit('user', null);
  }
});

window.addEventListener('online', () => {
  store.online = true;
  emit('network', true);
});
window.addEventListener('offline', () => {
  store.online = false;
  emit('network', false);
});
