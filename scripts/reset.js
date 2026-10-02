#!/usr/bin/env node
/**
 * 数据库维护脚本。
 *   node scripts/reset.js              删库重建 + 写入种子数据
 *   node scripts/reset.js --seed-only  仅在空库时写入种子数据
 */
import { rmSync, existsSync } from 'node:fs';
import { config } from '../server/config.js';
import { initDb, closeDb, get } from '../server/db.js';
import { seed, needsSeed } from '../server/models/seed.js';

const seedOnly = process.argv.includes('--seed-only');

if (!seedOnly) {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${config.dbFile}${suffix}`;
    if (existsSync(file)) {
      rmSync(file);
      process.stdout.write(`  已删除 ${file}\n`);
    }
  }
  if (existsSync(config.uploadDir)) {
    rmSync(config.uploadDir, { recursive: true, force: true });
    process.stdout.write(`  已清空 ${config.uploadDir}\n`);
  }
}

initDb();

if (seedOnly && !needsSeed()) {
  process.stdout.write('数据库已有数据，跳过种子写入（使用 --seed-only 时不覆盖）\n');
} else {
  const { admin, demo } = seed();
  process.stdout.write(
    [
      '种子数据已就绪：',
      `  管理员  ${admin.email}`,
      `  演示号  ${demo.email} / ${config.demoPassword}`,
      '',
    ].join('\n'),
  );
}

const counts = get('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM notes) AS notes').users;
process.stdout.write(`当前用户数：${counts}\n`);
closeDb();
