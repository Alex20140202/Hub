import { notFound } from '../lib/http-error.js';

/** 将 `/api/notes/:id` 编译成正则，并提取参数名。 */
function compile(pattern) {
  const names = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), names };
}

export function createRouter() {
  const middlewares = [];
  const routes = [];

  const add = (method, pattern, handler) => {
    const { regex, names } = compile(pattern);
    routes.push({ method, pattern, regex, names, handler });
  };

  return {
    use(fn) {
      middlewares.push(fn);
      return this;
    },
    get: (pattern, handler) => add('GET', pattern, handler),
    post: (pattern, handler) => add('POST', pattern, handler),
    put: (pattern, handler) => add('PUT', pattern, handler),
    patch: (pattern, handler) => add('PATCH', pattern, handler),
    delete: (pattern, handler) => add('DELETE', pattern, handler),

    /** 命中路由返回 { route, params }，未命中返回 null（由上层决定 404 还是 405）。 */
    match(method, pathname) {
      let pathExists = false;
      for (const route of routes) {
        const found = route.regex.exec(pathname);
        if (!found) continue;
        pathExists = true;
        if (route.method !== method) continue;
        const params = {};
        route.names.forEach((name, index) => {
          params[name] = decodeURIComponent(found[index + 1]);
        });
        return { route, params };
      }
      return pathExists ? { methodMismatch: true } : null;
    },
    get middlewares() {
      return middlewares;
    },
    get routes() {
      return routes;
    },
  };
}

/** 依次执行中间件与最终处理器，next() 传递控制权。 */
export async function runStack(stack, ctx, done) {
  let index = -1;
  async function next() {
    index += 1;
    const layer = stack[index];
    if (!layer) return done(ctx);
    try {
      await layer(ctx, next);
    } catch (error) {
      ctx.fail?.(error);
    }
  }
  return next();
}

export { notFound };
