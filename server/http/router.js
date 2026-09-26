/** 极简路由器：支持 /posts/:id 形式的路径参数与通配 * */
import HttpError from '../lib/http-error.js';
import { readBody } from './body.js';
import { parseCookies, sendJson, sendEmpty } from './respond.js';
import { getClientIp } from './body.js';
import { verify } from '../lib/jwt.js';
import { sessionActive } from '../lib/session.js';
import config from '../config.js';

function compile(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      if (seg === '*') {
        keys.push('wildcard');
        return '(.*)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { re: new RegExp(`^${source}/?$`), keys };
}

export class Router {
  constructor() {
    this.routes = [];
    this.hooks = [];
  }

  use(fn) {
    this.hooks.push(fn);
    return this;
  }

  add(method, pattern, handler, meta = {}) {
    // 记录定义时已注册的 hooks，使子路由挂载后仍能正确执行中间件
    this.routes.push({ method, pattern, ...compile(pattern), handler, meta, hooks: [...this.hooks] });
    return this;
  }

  get(p, h, m) { return this.add('GET', p, h, m); }
  post(p, h, m) { return this.add('POST', p, h, m); }
  put(p, h, m) { return this.add('PUT', p, h, m); }
  patch(p, h, m) { return this.add('PATCH', p, h, m); }
  delete(p, h, m) { return this.add('DELETE', p, h, m); }

  /** 挂载子路由，可加前缀（路径需重新编译，hooks 一并继承） */
  mount(prefix, router) {
    for (const r of router.routes) {
      const pattern = `${prefix}${r.pattern}`;
      this.routes.push({
        method: r.method,
        pattern,
        ...compile(pattern),
        handler: r.handler,
        meta: r.meta,
        hooks: r.hooks,
      });
    }
    return this;
  }

  match(method, pathname) {
    let pathExists = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathExists = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1] ?? '');
      });
      return { route: r, params };
    }
    if (pathExists) throw new HttpError(405, '请求方法不被支持');
    return null;
  }
}

/** 组装 ctx：包含 req/res/url/query/params/body/user 等 */
export function createContext(req, res, { url, params, route, log }) {
  const ctx = {
    req,
    res,
    log,
    url,
    method: req.method,
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    params: params || {},
    cookies: parseCookies(req),
    body: {},
    files: {},
    user: null,
    started: Date.now(),
    ip: getClientIp(req),
    get(key) {
      return this.headers[key.toLowerCase()];
    },
    headers: req.headers,
    setHeader(k, v) {
      res.setHeader(k, v);
    },
  };

  ctx.json = (status, payload, headers) => sendJson(res, status, payload, headers);
  ctx.ok = (payload = { ok: true }) => sendJson(res, 200, payload);
  ctx.created = (payload) => sendJson(res, 201, payload);
  ctx.noContent = () => sendEmpty(res, 204);
  ctx.fail = (status, message, extra) => {
    sendJson(res, status, { error: message, ...(extra || {}) });
  };
  return ctx;
}

/** 从 token / cookie 解析登录用户 */
export function attachUser(ctx) {
  const bearer = ctx.headers.authorization?.replace(/^Bearer\s+/i, '');
  const token = bearer || ctx.cookies[config.auth.cookie];
  if (!token) return null;
  const payload = verify(token);
  if (!payload?.sub) return null;
  if (!sessionActive(payload.sid)) return null;
  return {
    id: payload.sub,
    sid: payload.sid,
    role: payload.role || 'user',
    name: payload.name,
    username: payload.name,
    nickname: payload.nick || payload.name,
  };
}

export { readBody };
