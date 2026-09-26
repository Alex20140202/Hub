/** API 客户端：统一错误、token 管理、请求取消 */

const TOKEN_KEY = 'hub.token';

export class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload || {};
  }
}

export const token = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  },
  set(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* 隐私模式忽略 */
    }
  },
};

function buildUrl(path, params) {
  const raw = String(path || '');
  const absolute = /^https?:\/\//i.test(raw);
  // 除完整 URL 与已带 /api 前缀的路径外，一律挂到 /api 之下
  const full = absolute || raw.startsWith('/api/') || raw === '/api'
    ? raw
    : `/api${raw.startsWith('/') ? raw : `/${raw}`}`;
  const url = new URL(full, location.origin);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, v);
  }
  return url.toString();
}

async function request(method, path, { params, body, signal, raw } = {}) {
  const url = buildUrl(path, params);
  const headers = { Accept: 'application/json' };
  const auth = token.get();
  if (auth) headers.Authorization = `Bearer ${auth}`;

  let payload;
  if (raw instanceof FormData) {
    payload = raw;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, signal, credentials: 'same-origin' });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, '网络连接失败，请检查服务是否运行');
  }

  if (res.status === 204) return null;

  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();

  if (!res.ok) {
    const message = (isJson && data?.error) || (typeof data === 'string' && data.slice(0, 120)) || `请求失败（${res.status}）`;
    if (res.status === 401) {
      token.set('');
      window.dispatchEvent(new CustomEvent('hub:unauthorized'));
    }
    throw new ApiError(res.status, message, isJson ? data : {});
  }
  return data;
}

export const api = {
  get: (path, params, opts) => request('GET', path, { params, ...opts }),
  post: (path, body, opts) => request('POST', path, { body, ...opts }),
  put: (path, body, opts) => request('PUT', path, { body, ...opts }),
  patch: (path, body, opts) => request('PATCH', path, { body, ...opts }),
  del: (path, opts) => request('DELETE', path, opts),
  upload: (path, formData, opts) => request('POST', path, { raw: formData, ...opts }),
  url: buildUrl,
};

/* ---------- 语义化接口封装 ---------- */
export const AuthAPI = {
  me: () => api.get('/auth/me'),
  login: (login, password) => api.post('/auth/login', { login, password }),
  register: (data) => api.post('/auth/register', data),
  logout: () => api.post('/auth/logout'),
  update: (patch) => api.patch('/auth/me', patch),
  settings: () => api.get('/auth/settings'),
  saveSettings: (data) => api.patch('/auth/settings', data),
  sessions: () => api.get('/auth/sessions'),
  passwordScore: (password) => api.get('/auth/password-score', { password }),
  export: () => api.get('/export'),
};

export const PostAPI = {
  list: (params) => api.get('/posts', params),
  featured: () => api.get('/posts/featured'),
  get: (idOrSlug) => api.get(`/posts/${encodeURIComponent(idOrSlug)}`),
  create: (data) => api.post('/posts', data),
  update: (id, data) => api.put(`/posts/${id}`, data),
  remove: (id) => api.del(`/posts/${id}`),
  like: (id) => api.post(`/posts/${id}/like`),
  bookmark: (id) => api.post(`/posts/${id}/bookmark`),
  comments: (id) => api.get(`/posts/${id}/comments`),
  addComment: (id, body) => api.post(`/posts/${id}/comments`, body),
  editComment: (id, body) => api.patch(`/comments/${id}`, { body }),
  removeComment: (id) => api.del(`/comments/${id}`),
  categories: () => api.get('/categories'),
  createCategory: (data) => api.post('/categories', data),
  updateCategory: (id, data) => api.patch(`/categories/${id}`, data),
  removeCategory: (id) => api.del(`/categories/${id}`),
  tags: () => api.get('/tags'),
};

export const NoteAPI = {
  list: (params) => api.get('/notes', params),
  get: (id) => api.get(`/notes/${id}`),
  create: (data) => api.post('/notes', data),
  update: (id, data) => api.patch(`/notes/${id}`, data),
  remove: (id) => api.del(`/notes/${id}`),
};

export const TodoAPI = {
  list: (params) => api.get('/todos', params),
  create: (data) => api.post('/todos', data),
  update: (id, data) => api.patch(`/todos/${id}`, data),
  toggle: (id) => api.post(`/todos/${id}/toggle`),
  remove: (id) => api.del(`/todos/${id}`),
  clear: () => api.post('/todos/clear-completed'),
};

export const LinkAPI = {
  list: (params) => api.get('/links', params),
  create: (data) => api.post('/links', data),
  update: (id, data) => api.patch(`/links/${id}`, data),
  remove: (id) => api.del(`/links/${id}`),
  click: (id) => api.post(`/links/${id}/click`),
};

export const ShortAPI = {
  list: () => api.get('/shorts'),
  create: (data) => api.post('/shorts', data),
  update: (id, data) => api.patch(`/shorts/${id}`, data),
  remove: (id) => api.del(`/shorts/${id}`),
};

export const FileAPI = {
  list: (params) => api.get('/files', params),
  upload: (formData) => api.upload('/files', formData),
  update: (id, data) => api.patch(`/files/${id}`, data),
  remove: (id) => api.del(`/files/${id}`),
};

export const StatsAPI = {
  overview: () => api.get('/stats/overview'),
  dashboard: () => api.get('/stats/dashboard'),
  trend: (days = 14) => api.get('/stats/trend', { days }),
  heatmap: () => api.get('/stats/heatmap'),
  leaderboard: () => api.get('/stats/leaderboard'),
};

export const PointsAPI = {
  overview: () => api.get('/points/overview'),
  checkin: () => api.post('/points/checkin'),
  logs: (params) => api.get('/points/logs', params),
  leaderboard: (limit = 20) => api.get('/points/leaderboard', { limit }),
};

export const ShopAPI = {
  items: () => api.get('/shop/items'),
  mine: () => api.get('/shop/mine'),
  redeem: (id) => api.post(`/shop/redeem/${id}`),
  use: (id) => api.post(`/shop/use/${id}`),
};

export const PublicAPI = {
  search: (q) => api.get('/search', { q }),
  user: (username) => api.get(`/users/${encodeURIComponent(username)}`),
  users: (params) => api.get('/users', params),
  health: () => api.get('/health'),
};

/** 聊天：WebSocket 之外的分页历史、未读与房间管理（仅用于降级与角标轮询） */
export const ChatAPI = {
  rooms: () => api.get('/chat/rooms'),
  room: (slug) => api.get(`/chat/rooms/${encodeURIComponent(slug)}`),
  createRoom: (data) => api.post('/chat/rooms', data),
  history: (room = 'lobby', before = null, limit = 50) => api.get('/chat/history', { room, before, limit }),
  post: (data) => api.post('/chat/messages', data),
  unread: () => api.get('/chat/unread'),
  markRead: (room, at) => api.post('/chat/read', { room, at }),
};

export const AdminAPI = {
  overview: () => api.get('/admin/overview'),
  comments: (status) => api.get('/admin/comments', { status }),
  setCommentStatus: (id, status) => api.patch(`/admin/comments/${id}`, { status }),
  events: () => api.get('/admin/events'),
  setRole: (id, role) => api.post(`/admin/users/${id}/role`, { role }),
  removeUser: (id) => api.del(`/admin/users/${id}`),
  saveSettings: (data) => api.post('/admin/settings', data),
  chat: () => api.get('/admin/chat'),
  chatMessages: (params) => api.get('/admin/chat/messages', params),
  createChatRoom: (data) => api.post('/admin/chat/rooms', data),
  updateChatRoom: (slug, data) => api.patch(`/admin/chat/rooms/${encodeURIComponent(slug)}`, data),
  deleteChatRoom: (slug) => api.del(`/admin/chat/rooms/${encodeURIComponent(slug)}`),
  muteChat: (target, minutes, reason) => api.post('/admin/chat/mute', { target, minutes, reason }),
  unmuteChat: (target) => api.del('/admin/chat/mute', { params: { target } }),
  clearChat: (room = 'lobby') => api.post('/admin/chat/clear', { room }),
  feature: (id) => api.post(`/admin/posts/${id}/feature`),
  points: () => api.get('/admin/points'),
  createShopItem: (data) => api.post('/admin/shop/items', data),
  updateShopItem: (id, data) => api.patch(`/admin/shop/items/${id}`, data),
  database: () => api.get('/admin/database'),
  vacuum: () => api.post('/admin/maintenance/vacuum'),
};
