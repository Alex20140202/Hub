import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { migrations } from './migrations.js';

let db = null;

function open(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const handle = new DatabaseSync(file);
  handle.exec('PRAGMA journal_mode = WAL');
  handle.exec('PRAGMA foreign_keys = ON');
  handle.exec('PRAGMA busy_timeout = 5000');
  return handle;
}

/** 打开数据库并按序号执行尚未应用的迁移。 */
export function initDb(file = config.dbFile) {
  if (db) return db;
  db = open(file);
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM _migrations').all().map((row) => row.name));
  for (const { name, up } of migrations) {
    if (done.has(name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(up);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, datetime(\'now\'))').run(name);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`迁移 ${name} 失败：${error.message}`);
    }
    process.stdout.write(`  迁移已应用 ${name}\n`);
  }
  return db;
}

export function getDb() {
  return db ?? initDb();
}

const plain = (row) => (row ? { ...row } : row);

export function all(sql, ...params) {
  return getDb().prepare(sql).all(...params).map(plain);
}

export function get(sql, ...params) {
  return plain(getDb().prepare(sql).get(...params)) ?? null;
}

export function run(sql, ...params) {
  const result = getDb().prepare(sql).run(...params);
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}

export function pluck(sql, ...params) {
  const row = getDb().prepare(sql).get(...params);
  if (!row) return null;
  return Object.values(plain(row))[0];
}

/** 同步事务包装：回调抛错则整体回滚。 */
export function tx(fn) {
  const handle = getDb();
  handle.exec('BEGIN');
  try {
    const result = fn();
    handle.exec('COMMIT');
    return result;
  } catch (error) {
    handle.exec('ROLLBACK');
    throw error;
  }
}

export function closeDb() {
  if (!db) return;
  db.close();
  db = null;
}
