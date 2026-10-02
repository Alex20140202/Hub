import { createServer } from 'node:http';
import { config, suggestSecret } from './config.js';
import { initDb, closeDb } from './db.js';
import { seed } from './models/seed.js';
import { handleRequest, reloadAssets } from './app.js';
import { logger } from './lib/logger.js';
import { mkdirSync } from 'node:fs';

initDb();
const accounts = seed();
mkdirSync(config.uploadDir, { recursive: true });
reloadAssets();

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    logger.error('未捕获异常:', error.stack ?? String(error));
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('服务器内部错误');
  });
});

server.listen(config.port, config.host, () => {
  const base = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  logger.info(`站点已启动 ${base}`);
  logger.info(`管理员 ${accounts.admin.email} · 演示账号 ${accounts.demo.email}`);
  if (!config.isProd && !process.env.JWT_SECRET) {
    logger.debug(`开发密钥（重启后会话仍有效）：${config.tokenSecret.slice(0, 12)}…`);
    logger.debug(`生产环境请设置 JWT_SECRET，例如 ${suggestSecret().slice(0, 12)}…`);
  }
});

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (closing) process.exit(0);
    closing = true;
    logger.info(`收到 ${signal}，正在关闭…`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

process.on('unhandledRejection', (reason) => logger.error('未处理的 Promise 拒绝:', reason));
