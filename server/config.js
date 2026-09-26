import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(ROOT, process.env.UPLOAD_DIR)
  : path.join(ROOT, 'public', 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** 极简 .env 解析：KEY=VALUE，# 注释 */
function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile();

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const isProd = process.env.NODE_ENV === 'production';

const devSecret = crypto.createHash('sha256').update(`hub-dev-secret::${ROOT}`).digest('hex');
const secret = process.env.JWT_SECRET || (isProd ? '' : devSecret);
if (isProd && !process.env.JWT_SECRET) {
  console.warn('[config] 警告：生产环境未设置 JWT_SECRET，会话在重启后失效。');
}

export const config = {
  root: ROOT,
  env: process.env.NODE_ENV || 'development',
  isProd,
  host: process.env.HOST || '0.0.0.0',
  port: num(process.env.PORT, 3535),
  paths: {
    root: ROOT,
    public: path.join(ROOT, 'public'),
    uploads: UPLOAD_DIR,
    data: DATA_DIR,
    db: process.env.DB_FILE || path.join(DATA_DIR, 'hub.db'),
  },
  auth: {
    secret,
    tokenTtlSec: 60 * 60 * 24 * 7,
    cookie: 'hub_token',
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@hub.dev',
    password: process.env.ADMIN_PASSWORD || 'admin12345',
  },
  limits: {
    uploadBytes: num(process.env.MAX_UPLOAD_BYTES, 10 * 1024 * 1024),
    bodyBytes: 2 * 1024 * 1024,
    jsonDepth: 12,
  },
  chat: {
    // 消息体上限：超过直接拒绝，不再静默截断
    bodyMax: num(process.env.CHAT_BODY_MAX, 2000),
    // 每个房间持久化保留的消息条数
    keepPerRoom: num(process.env.CHAT_KEEP_PER_ROOM, 500),
    // 历史分页每页条数 / 单次加载上限
    pageSize: 50,
    pageMax: 120,
    // 首次握手下发的历史条数
    historyOnReady: 50,
    // 限流：滑动窗口内的最大发言数
    rateWindowMs: num(process.env.CHAT_RATE_WINDOW_MS, 5000),
    rateMax: num(process.env.CHAT_RATE_MAX, 8),
    // 连接上限（单 IP / 全局），防止刷连接耗尽资源
    maxPerIp: num(process.env.CHAT_MAX_PER_IP, 6),
    maxTotal: num(process.env.CHAT_MAX_TOTAL, 500),
    // 指令与反应
    reactions: ['👍', '❤️', '😂', '🎉', '🚀', '👀', '🙏', '🤔'],
    // 心跳
    heartbeatMs: num(process.env.CHAT_HEARTBEAT_MS, 25_000),
  },
  site: {
    name: 'Hub',
    tagline: '一个 Node.js 驱动的全栈综合站点',
  },
};

export default config;
