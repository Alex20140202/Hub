import { readFileSync, existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 解析项目根目录的 .env（KEY=VALUE，# 注释），不覆盖已存在的环境变量。 */
function loadEnvFile() {
  const file = path.join(rootDir, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const eq = text.indexOf('=');
    if (eq < 1) continue;
    const key = text.slice(0, eq).trim();
    if (key in process.env) continue;
    process.env[key] = text.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
}

loadEnvFile();

const num = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** 开发环境按项目路径派生密钥，保证同机重启会话不失效。 */
function devSecret() {
  return createHash('sha256').update(`hub@${rootDir}`).digest('hex');
}

const isProd = process.env.NODE_ENV === 'production';
const secret = process.env.JWT_SECRET || devSecret();

if (isProd && !process.env.JWT_SECRET) {
  throw new Error('生产环境必须设置 JWT_SECRET 环境变量');
}

export const config = {
  isProd,
  host: process.env.HOST || '127.0.0.1',
  port: num(process.env.PORT, 4000),
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  clientDir: path.join(rootDir, 'client'),
  dataDir: path.join(rootDir, 'data'),
  dbFile: process.env.DB_FILE || path.join(rootDir, 'data', 'hub.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(rootDir, 'data', 'uploads'),
  tokenSecret: secret,
  tokenTtlMs: num(process.env.TOKEN_TTL_HOURS, 24 * 14) * 3600_000,
  maxUploadBytes: num(process.env.MAX_UPLOAD_BYTES, 25 * 1024 * 1024),
  maxJsonBytes: 1024 * 1024,
  adminEmail: process.env.ADMIN_EMAIL || 'admin@hub.dev',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin12345',
  demoEmail: process.env.DEMO_EMAIL || 'demo@hub.dev',
  demoPassword: process.env.DEMO_PASSWORD || 'demo12345',
  secureCookies: process.env.COOKIE_SECURE === 'true',
};

/** 供开发期临时重置密码用，生成一个可用的强密钥。 */
export function suggestSecret() {
  return randomBytes(32).toString('hex');
}
