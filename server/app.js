import { createRouter } from './http/router.js';
import { readBody, readQuery } from './http/context.js';
import { parseCookies } from './http/body.js';
import { sendJson, sendHtml, sendError, applySecurityHeaders, sendText, redirect } from './http/respond.js';
import { serveStatic } from './http/static.js';
import { unauthorized, notFound, tooMany, HttpError } from './lib/http-error.js';
import { createLimiter } from './lib/rate-limit.js';
import { logger } from './lib/logger.js';
import { config } from './config.js';
import { resolveUser, register as registerAuth } from './routes/auth.js';
import { registerNotes, registerTodos, registerLinks, registerFiles } from './routes/workspace.js';
import { registerDashboard, registerPublic, registerAdmin } from './routes/dashboard.js';
import { renderPage } from './views/render.js';
import { getSettings } from './models/stats.js';
import * as notes from './models/notes.js';
import * as todos from './models/todos.js';
import * as links from './models/links.js';
import * as files from './models/files.js';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const apiLimiter = createLimiter({ windowMs: 60_000, max: 900, name: 'api' });

/** 读取构建产物清单，缺失时退回占位版本号。 */
function readAssets() {
  const manifestPath = path.join(config.publicDir, 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) {
    logger.warn('未找到 public/assets/manifest.json，请先执行 npm run build');
    return { css: 'dev', js: 'dev' };
  }
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return { css: 'dev', js: 'dev' };
  }
}

let assets = readAssets();
export const reloadAssets = () => {
  assets = readAssets();
};

const router = createRouter();

registerAuth(router);
registerNotes(router);
registerTodos(router);
registerLinks(router);
registerFiles(router);
registerDashboard(router);
registerPublic(router);
registerAdmin(router);

// 个人数据导出
router.get('/api/export', async (ctx) => {
  const user = ctx.requireUser();
  const payload = {
    exportedAt: new Date().toISOString(),
    user: { username: user.username, nickname: user.nickname, email: user.email, bio: user.bio },
    notes: notes.listNotes(user.id, { limit: 1000 }).items,
    todos: todos.listTodos(user.id),
    links: links.listLinks(user.id).length ? links.listLinks(user.id) : [],
    files: files.listFiles(user.id),
  };
  ctx.json(200, payload, {
    'Content-Disposition': `attachment; filename="hub-export-${user.username}.json"`,
  });
});

router.get('/api/health', async (ctx) => {
  ctx.json(200, { ok: true, uptime: Math.round(process.uptime()), env: config.isProd ? 'production' : 'development' });
});

/* --------------------------------- 请求处理 --------------------------------- */

/** 需要登录才能访问的路径前缀。 */
const PROTECTED = ['/notes', '/todos', '/links', '/files', '/settings', '/admin', '/dashboard', '/search'];
const isProtected = (pathname) => PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

function clientIpOf(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

/** 组装请求上下文并执行匹配的路由 / 页面渲染。 */
export async function handleRequest(req, res) {
  const started = process.hrtime.bigint();
  applySecurityHeaders(res);

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/{2,}/g, '/');
  const cookies = parseCookies(req.headers.cookie);
  const auth = resolveUser(req, cookies);

  const cookiesToSet = [];
  const ctx = {
    req,
    res,
    url,
    pathname,
    query: readQuery(url),
    params: {},
    user: auth?.user ?? null,
    auth,
    sessionId: auth?.sessionId ?? null,
    clientIp: clientIpOf(req),
    input: () => readBody(req),
    setCookie: (cookie) => cookiesToSet.push(cookie),
    json: (status, payload, headers) => {
      if (cookiesToSet.length) headers = { 'Set-Cookie': cookiesToSet, ...headers };
      sendJson(res, status, payload, headers);
    },
    requireUser() {
      if (!ctx.user) throw unauthorized();
      return ctx.user;
    },
    download: (filePath, filename, mime) => {
      if (!existsSync(filePath)) throw notFound('文件已丢失');
      const data = readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': mime || 'application/octet-stream',
        'Content-Length': data.length,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      });
      res.end(data);
    },
  };

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const code = res.statusCode;
    const level = code >= 500 ? 'error' : code >= 400 ? 'warn' : 'debug';
    logger[level](`${req.method} ${pathname} ${code} ${ms.toFixed(1)}ms`);
  });

  try {
    // 1. 静态资源
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (serveStatic(req, res, config.publicDir, pathname)) return;
      // 带扩展名的请求（如 /assets/app.js 缺失）直接 404，避免被页面渲染兜底
      if (/\.[a-z0-9]{2,5}$/i.test(pathname)) throw notFound('资源不存在');
    }

    // 2. 接口限流（只统计 /api）
    if (pathname.startsWith('/api/') && apiLimiter.take(ctx.clientIp)) {
      throw tooMany('请求过于频繁，请稍后再试');
    }

    // 3. API 与页面路由
    const matched = router.match(req.method, pathname);
    if (matched?.route) {
      ctx.params = matched.params;
      await matched.route.handler(ctx);
      return;
    }
    if (matched?.methodMismatch) throw new HttpError(405, '请求方法不被支持');

    // 4. 页面：SSR 整页或片段
    if (pathname.startsWith('/api/')) throw notFound('接口不存在');
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '请求方法不被支持');

    // 未登录访问受保护页面：整页请求跳登录，片段请求返回 401 交由客户端处理
    if (!ctx.user && isProtected(pathname)) {
      if (url.searchParams.get('_partial') === '1') throw unauthorized('请先登录');
      const target = `${pathname}${url.search}`;
      return redirect(res, `/login?next=${encodeURIComponent(target)}`, 302);
    }

    const wantsPartial = url.searchParams.get('_partial') === '1';
    const page = await renderPage({
      pathname,
      user: ctx.user,
      query: ctx.query,
      params: ctx.params,
      sessionId: ctx.sessionId,
      assets,
      partial: wantsPartial,
    });
    if (wantsPartial) return sendText(res, page.status, page.html, 'text/html; charset=utf-8');
    return sendHtml(res, page.status, page.html);
  } catch (error) {
    const failure = error instanceof HttpError ? error : new HttpError(500, '服务器内部错误');
    if (!(error instanceof HttpError)) logger.error(error.stack ?? String(error));
    if (cookiesToSet.length) res.setHeader('Set-Cookie', cookiesToSet);
    if (pathname.startsWith('/api/')) return sendError(res, failure);
    if (url.searchParams.get('_partial') === '1') return sendText(res, failure.status, failure.message);
    return sendHtml(
      res,
      failure.status,
      errorPage(failure, getSettings(), assets),
    );
  }
}

function errorPage(error, settings, buildAssets) {
  const safe = error.status < 500;
  return `<!doctype html><html lang="zh-CN" data-theme="auto"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${error.status} · ${escape(settings.site_name)}</title>
<link rel="stylesheet" href="/assets/app.css?v=${buildAssets.css}"></head>
<body class="is-guest"><main class="guest"><section class="auth-card">
<p class="hero-eyebrow">${error.status}</p>
<h1>${escape(safe ? error.message : '服务器开了个小差')}</h1>
<p class="auth-sub">${safe ? '可以回到仪表盘继续使用。' : '请稍后重试，若持续出现请查看服务端日志。'}</p>
<a class="btn btn-primary btn-block" href="/">回到首页</a>
</section></main></body></html>`;
}

const escape = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
