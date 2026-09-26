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
  port: num(process.env.PORT, 3000),
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
  site: {
    name: 'Hub',
    tagline: '一个 Node.js 驱动的全栈综合站点',
  },
};

export default config;
