/** 与服务端 API 通信的薄封装：统一错误信息与忙碌态。 */

class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };

  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('网络连接失败，请检查服务是否在运行', 0);
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json().catch(() => ({})) : null;

  if (!response.ok) {
    throw new ApiError(payload?.error ?? `请求失败（${response.status}）`, response.status, payload?.details);
  }
  return payload ?? {};
}

/** 拉取服务端渲染的页面片段（服务端是标记的唯一来源）。 */
export async function fetchFragment(path) {
  const url = new URL(path, location.origin);
  url.searchParams.set('_partial', '1');
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new ApiError('页面加载失败', response.status);
  return response.text();
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path, body) => request('DELETE', path, body),

  auth: {
    login: (payload) => request('POST', '/api/auth/login', payload),
    register: (payload) => request('POST', '/api/auth/register', payload),
    logout: () => request('POST', '/api/auth/logout'),
    me: () => request('GET', '/api/auth/me'),
    updateProfile: (payload) => request('PATCH', '/api/auth/me', payload),
    changePassword: (payload) => request('POST', '/api/auth/password', payload),
    passwordScore: (password) => request('GET', `/api/auth/password-score?password=${encodeURIComponent(password)}`),
    sessions: () => request('GET', '/api/auth/sessions'),
    killSession: (id) => request('DELETE', `/api/auth/sessions/${encodeURIComponent(id)}`),
  },

  notes: {
    list: (params = '') => request('GET', `/api/notes${params}`),
    create: (payload) => request('POST', '/api/notes', payload),
    update: (id, payload) => request('PATCH', `/api/notes/${id}`, payload),
    remove: (id) => request('DELETE', `/api/notes/${id}`),
  },
  todos: {
    list: (params = '') => request('GET', `/api/todos${params}`),
    create: (payload) => request('POST', '/api/todos', payload),
    update: (id, payload) => request('PATCH', `/api/todos/${id}`, payload),
    remove: (id) => request('DELETE', `/api/todos/${id}`),
    clearCompleted: () => request('POST', '/api/todos/clear-completed'),
    reorder: (order) => request('POST', '/api/todos/reorder', { order }),
  },
  links: {
    list: (params = '') => request('GET', `/api/links${params}`),
    create: (payload) => request('POST', '/api/links', payload),
    update: (id, payload) => request('PATCH', `/api/links/${id}`, payload),
    remove: (id) => request('DELETE', `/api/links/${id}`),
    click: (id) => request('POST', `/api/links/${id}/click`),
  },
  files: {
    list: (params = '') => request('GET', `/api/files${params}`),
    upload: (form) => request('POST', '/api/files', form),
    remove: (id) => request('DELETE', `/api/files/${id}`),
  },
  blog: {
    list: (params = '') => request('GET', `/api/posts${params}`),
    meta: () => request('GET', '/api/posts/meta'),
    get: (idOrSlug) => request('GET', `/api/posts/${encodeURIComponent(idOrSlug)}`),
    create: (payload) => request('POST', '/api/posts', payload),
    update: (id, payload) => request('PUT', `/api/posts/${id}`, payload),
    remove: (id) => request('DELETE', `/api/posts/${id}`),
    like: (id) => request('POST', `/api/posts/${id}/like`),
    bookmark: (id) => request('POST', `/api/posts/${id}/bookmark`),
    comment: (id, payload) => request('POST', `/api/posts/${id}/comments`, payload),
    likeComment: (id) => request('POST', `/api/comments/${id}/like`),
    bookmarks: () => request('GET', '/api/bookmarks'),
  },
  shorts: {
    list: () => request('GET', '/api/shorts'),
    create: (payload) => request('POST', '/api/shorts', payload),
    toggle: (id, active) => request('PATCH', `/api/shorts/${id}`, { active }),
    remove: (id) => request('DELETE', `/api/shorts/${id}`),
  },
  points: {
    overview: () => request('GET', '/api/points/overview'),
    checkin: () => request('POST', '/api/points/checkin'),
    redeem: (itemId) => request('POST', `/api/shop/redeem/${itemId}`),
    use: (ownedId) => request('POST', `/api/shop/use/${ownedId}`),
  },
  preview: (markdown) => request('POST', '/api/preview', { markdown }),
  subscribe: (email) => request('POST', '/api/subscribe', { email }),

  admin: {
    overview: () => request('GET', '/api/admin/overview'),
    setRole: (id, role) => request('POST', `/api/admin/users/${id}/role`, { role }),
    removeUser: (id) => request('DELETE', `/api/admin/users/${id}`),
    settings: () => request('GET', '/api/admin/settings'),
    updateSettings: (payload) => request('PATCH', '/api/admin/settings', payload),
  },
};

export { ApiError };
