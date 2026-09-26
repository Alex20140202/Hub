import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import config from './config.js';
import logger from './lib/logger.js';
import HttpError from './lib/http-error.js';
import { migrate } from './db.js';
import { seedIfEmpty } from './models/seed.js';
import { Router, createContext, attachUser, readBody } from './http/router.js';
import { createStaticHandler, mimeFor } from './http/static.js';
import { sendJson, sendHtml, SECURITY_HEADERS } from './http/respond.js';
import { getClientIp } from './http/body.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { setupChat } from './ws/chat.js';
import { pruneSessions } from './lib/session.js';
import { resolveShort } from './services/redirect.js';

import authRoutes from './routes/auth.js';
import postRoutes from './routes/posts.js';
import workspaceRoutes from './routes/workspace.js';
import miscRoutes from './routes/misc.js';
import publicRoutes from './routes/public.js';
import pointsRoutes from './routes/points.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------- 数据库启动 ---------- */
migrate();
const seeded = seedIfEmpty();
pruneSessions();

/* ---------- 路由装配 ---------- */
const api = new Router();
api.mount('/auth', authRoutes); // /auth/login /auth/register /auth/me /auth/sessions /auth/settings
api.mount('', postRoutes); // /posts /categories /tags /comments
api.mount('', workspaceRoutes); // /notes /todos /links
api.mount('', miscRoutes); // /shorts /files /subscribe /export /health
api.mount('', publicRoutes); // /stats /search /users /chat /admin
api.mount('', pointsRoutes); // /points /shop

const globalLimiter = createRateLimiter({ windowMs: 60_000, max: 1200 });

const serveUploads = createStaticHandler({ root: config.paths.uploads, urlPrefix: '/uploads/' });
const servePublic = createStaticHandler({ root: config.paths.public, urlPrefix: '/', immutable: false });

/* ---------- 错误页 ---------- */
function errorPage(status, message) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${status} · ${escapeHtml(config.site.name)}</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f19;color:#e2e8f0;
    font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
  .box{text-align:center;padding:48px}
  h1{font-size:96px;margin:0;background:linear-gradient(135deg,#818cf8,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent}
  p{color:#94a3b8;margin:12px 0 24px}
  a{display:inline-block;padding:10px 20px;border-radius:10px;background:#6366f1;color:#fff;text-decoration:none}
</style></head>
<body><div class="box"><h1>${status}</h1><p>${escapeHtml(message)}</p><a href="/">返回首页</a></div></body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 请求处理 ---------- */
const server = http.createServer(async (req, res) => {
  const started = process.hrtime.bigint();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const log = logger.child({ method: req.method, path: url.pathname });

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (res.statusCode >= 400 || ms > 250) {
      log.debug(`${res.statusCode} ${ms.toFixed(0)}ms`);
    }
  });

  try {
    // 静态资源与短链跳转不计入接口限流
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) globalLimiter(req);

    /* 1. API */
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const pathname = url.pathname.replace(/^\/api/, '') || '/';
      const matched = api.match(req.method, pathname);
      if (!matched) throw HttpError.notFound(`接口不存在：${req.method} ${url.pathname}`);
      const ctx = createContext(req, res, { url, params: matched.params, route: matched.route, log });
      ctx.user = attachUser(ctx);
      for (const hook of matched.route.hooks || []) await hook(ctx);
      const result = await matched.route.handler(ctx);
      if (!res.writableEnded) sendJson(res, 204, {});
      return void result;
    }

    /* 2. 上传文件直出 */
    if (url.pathname.startsWith('/uploads/')) {
      const served = await serveUploads(req, res, url.pathname);
      if (served) return;
      throw HttpError.notFound('文件不存在');
    }

    /* 3. 短链跳转 */
    const short = await resolveShort(url.pathname);
    if (short) {
      res.writeHead(302, { Location: short.target, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
      res.end();
      return;
    }

    /* 4. 静态资源 + SPA 回退 */
    if (req.method === 'GET' || req.method === 'HEAD') {
      const served = await servePublic(req, res, url.pathname);
      if (served) return;
      const index = path.join(config.paths.public, 'index.html');
      const html = await fs.promises.readFile(index);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': html.length,
        'Cache-Control': 'no-cache',
        ...SECURITY_HEADERS,
      });
      res.end(req.method === 'HEAD' ? undefined : html);
      return;
    }

    throw HttpError.notFound();
  } catch (err) {
    // 兜底：任何非数字状态码都不能进 writeHead，否则 catch 内再抛异常，
    // 响应永远发不出去，请求方只会一直等到超时
    const raw = Number(err.status ?? err.statusCode);
    const status = Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;
    if (status >= 500) log.error(err);
    else log.debug(`${status} ${err.message}`);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (url.pathname.startsWith('/api')) {
      sendJson(res, status, {
        error: err.message || '服务器内部错误',
        ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}),
        ...(config.isProd ? {} : { stack: String(err.stack || '').split('\n').slice(0, 4) }),
      });
    } else {
      sendHtml(res, status, errorPage(status, err.message || '出错了'));
    }
  }
});

/* ---------- WebSocket ---------- */
const wssClients = setupChat(server);
server.on('ws:log', (msg) => logger.info(`[ws] ${msg}`));

/* ---------- 启动 ---------- */
server.listen(config.port, config.host, () => {
  const url = `http://localhost:${config.port}`;
  logger.info('─'.repeat(56));
  logger.info(`  ${config.site.name} ${config.site.tagline}`);
  logger.info(`  服务地址   ${url}`);
  logger.info(`  运行环境   ${config.env} · Node ${process.version}`);
  logger.info(`  数据库     ${config.paths.db}`);
  logger.info(`  WebSocket  ws://localhost:${config.port}/ws`);
  if (seeded.admin) {
    logger.info(`  管理员     ${seeded.admin.email} / ${seeded.admin.password}`);
  }
  if (seeded.demo) {
    logger.info(`  演示账号   ${seeded.demo.email} / ${seeded.demo.password}`);
  }
  logger.info('─'.repeat(56));
});

/* ---------- 优雅退出 ---------- */
let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info(`收到 ${signal}，正在关闭服务…`);
  for (const c of wssClients) c.close(1001, 'server shutdown');
  server.close(() => {
    logger.info('已安全退出');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('未处理的 Promise 拒绝:', reason));
process.on('uncaughtException', (err) => logger.error('未捕获异常:', err));

export { server, config };
