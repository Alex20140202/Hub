/**
 * 数据库维护脚本
 *   node server/scripts/reset.js            清空数据库与上传目录后写入种子数据
 *   node server/scripts/reset.js --seed-only 仅在数据库为空时写入种子数据
 *   node server/scripts/reset.js --force     跳过交互确认
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import config from '../config.js';
import logger from '../lib/logger.js';

const seedOnly = process.argv.includes('--seed-only');
const force = process.argv.includes('--force');

const targets = [config.paths.db, `${config.paths.db}-wal`, `${config.paths.db}-shm`];

async function confirm() {
  if (force || seedOnly) return true;
  if (!process.stdin.isTTY) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`将清空 ${config.paths.db} 与上传目录，并写入种子数据，继续？(y/N) `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

if (!(await confirm())) {
  logger.info('已取消');
  process.exit(0);
}

// 先删文件再打开数据库：db.js 在导入时就会建立连接，
// 若先导入再 unlink，SQLite 仍会持有旧句柄，导致"已清空"却没有真正重置。
if (!seedOnly) {
  for (const t of targets) fs.rmSync(t, { force: true });
  const uploads = config.paths.uploads;
  if (fs.existsSync(uploads)) {
    for (const f of fs.readdirSync(uploads)) fs.rmSync(path.join(uploads, f), { force: true, recursive: true });
  }
  logger.info('已清空旧数据');
}

const { migrate } = await import('../db.js');
const { seedIfEmpty } = await import('../models/seed.js');
migrate();

const created = seedIfEmpty();
if (Object.keys(created).length === 0) {
  logger.info('数据库已有数据，跳过种子写入（加 --force 可强制重建）');
} else {
  logger.info('种子数据写入完成：');
  for (const [role, info] of Object.entries(created)) {
    logger.info(`  ${role}: ${info.email} / ${info.password}`);
  }
}
logger.info(`数据库位置：${config.paths.db}`);
process.exit(0);
