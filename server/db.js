import { DatabaseSync } from 'node:sqlite';
import config from './config.js';
import logger from './lib/logger.js';

export const db = new DatabaseSync(config.paths.db);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 4000');

const MIGRATIONS = [
  {
    name: '001_core',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id           TEXT PRIMARY KEY,
        username     TEXT NOT NULL UNIQUE,
        email        TEXT NOT NULL UNIQUE,
        password     TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'user',
        nickname     TEXT,
        bio          TEXT,
        avatar_color TEXT,
        website      TEXT,
        location     TEXT,
        theme        TEXT DEFAULT 'system',
        post_count   INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        last_login   TEXT
      );

      CREATE TABLE IF NOT EXISTS categories (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        slug        TEXT NOT NULL UNIQUE,
        description TEXT,
        color       TEXT DEFAULT '#6366f1',
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        slug       TEXT NOT NULL UNIQUE,
        color      TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS posts (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        slug         TEXT NOT NULL UNIQUE,
        excerpt      TEXT,
        content      TEXT NOT NULL,
        cover        TEXT,
        author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
        status       TEXT NOT NULL DEFAULT 'draft',
        featured     INTEGER NOT NULL DEFAULT 0,
        views        INTEGER NOT NULL DEFAULT 0,
        likes        INTEGER NOT NULL DEFAULT 0,
        reading_time INTEGER NOT NULL DEFAULT 1,
        published_at TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
      CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category_id);

      CREATE TABLE IF NOT EXISTS post_tags (
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS comments (
        id         TEXT PRIMARY KEY,
        post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        author_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
        parent_id  TEXT REFERENCES comments(id) ON DELETE CASCADE,
        body       TEXT NOT NULL,
        guest_name TEXT,
        ip_hash    TEXT,
        status     TEXT NOT NULL DEFAULT 'published',
        likes      INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);

      CREATE TABLE IF NOT EXISTS notes (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        content    TEXT NOT NULL DEFAULT '',
        color      TEXT DEFAULT 'default',
        pinned     INTEGER NOT NULL DEFAULT 0,
        archived   INTEGER NOT NULL DEFAULT 0,
        tags       TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS todos (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        detail     TEXT,
        priority   INTEGER NOT NULL DEFAULT 2,
        done       INTEGER NOT NULL DEFAULT 0,
        due_at     TEXT,
        project    TEXT,
        position   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id, done, priority);

      CREATE TABLE IF NOT EXISTS links (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        url        TEXT NOT NULL,
        note       TEXT,
        tags       TEXT NOT NULL DEFAULT '[]',
        category   TEXT DEFAULT 'general',
        favicon    TEXT,
        clicks     INTEGER NOT NULL DEFAULT 0,
        starred    INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS short_links (
        id         TEXT PRIMARY KEY,
        code       TEXT NOT NULL UNIQUE,
        target     TEXT NOT NULL,
        title      TEXT,
        user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
        clicks     INTEGER NOT NULL DEFAULT 0,
        active     INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );

      CREATE TABLE IF NOT EXISTS files (
        id          TEXT PRIMARY KEY,
        user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
        filename    TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        mime        TEXT NOT NULL,
        size        INTEGER NOT NULL,
        folder      TEXT DEFAULT 'misc',
        description TEXT,
        downloads   INTEGER NOT NULL DEFAULT 0,
        is_public   INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS subscribers (
        id         TEXT PRIMARY KEY,
        email      TEXT NOT NULL UNIQUE,
        status     TEXT NOT NULL DEFAULT 'pending',
        source     TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_agent TEXT,
        ip         TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id         TEXT PRIMARY KEY,
        room       TEXT NOT NULL DEFAULT 'lobby',
        user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
        nickname   TEXT NOT NULL,
        kind       TEXT NOT NULL DEFAULT 'chat',
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room, created_at DESC);

      CREATE TABLE IF NOT EXISTS events (
        id         TEXT PRIMARY KEY,
        user_id    TEXT,
        type       TEXT NOT NULL,
        target     TEXT,
        meta       TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at DESC);

      CREATE TABLE IF NOT EXISTS reactions (
        user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id  TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        kind     TEXT NOT NULL DEFAULT 'like',
        PRIMARY KEY (user_id, post_id, kind)
      );

      CREATE TABLE IF NOT EXISTS bookmarks (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, post_id)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    name: '002_points',
    sql: `
      ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN last_checkin TEXT;
      ALTER TABLE users ADD COLUMN storage_bonus INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN frame TEXT;
      ALTER TABLE users ADD COLUMN checkin_days INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS point_logs (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        delta      INTEGER NOT NULL,
        balance    INTEGER NOT NULL,
        reason     TEXT NOT NULL,
        detail     TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_point_logs_user ON point_logs(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS shop_items (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon        TEXT NOT NULL DEFAULT '🎁',
        price       INTEGER NOT NULL,
        kind        TEXT NOT NULL,
        payload     TEXT,
        stock       INTEGER NOT NULL DEFAULT -1,
        active      INTEGER NOT NULL DEFAULT 1,
        sort        INTEGER NOT NULL DEFAULT 100,
        sold        INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_items (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id    TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
        state      TEXT NOT NULL DEFAULT 'owned',
        created_at TEXT NOT NULL,
        used_at    TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_items_unique ON user_items(user_id, item_id);
    `,
  },
  {
    name: '003_checkins',
    sql: `
      CREATE TABLE IF NOT EXISTS checkins (
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day        TEXT NOT NULL,
        streak     INTEGER NOT NULL,
        gained     INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, day)
      );
    `,
  },
  {
    name: '004_skin',
    sql: `
      ALTER TABLE users ADD COLUMN skin TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    name: '005_chat',
    sql: `
      ALTER TABLE messages ADD COLUMN reply_to TEXT;
      ALTER TABLE messages ADD COLUMN edited_at TEXT;
      ALTER TABLE messages ADD COLUMN deleted_at TEXT;
      ALTER TABLE messages ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';

      CREATE TABLE IF NOT EXISTS chat_rooms (
        id         TEXT PRIMARY KEY,
        slug       TEXT NOT NULL UNIQUE,
        name       TEXT NOT NULL,
        topic      TEXT NOT NULL DEFAULT '',
        kind       TEXT NOT NULL DEFAULT 'public',
        sort       INTEGER NOT NULL DEFAULT 100,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_rooms_sort ON chat_rooms(sort, name);

      CREATE TABLE IF NOT EXISTS chat_reads (
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        room       TEXT NOT NULL,
        last_read  TEXT NOT NULL,
        PRIMARY KEY (user_id, room)
      );

      CREATE TABLE IF NOT EXISTS chat_reactions (
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        actor      TEXT NOT NULL,
        emoji      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (message_id, actor, emoji)
      );
      CREATE INDEX IF NOT EXISTS idx_chat_reactions_msg ON chat_reactions(message_id);

      CREATE TABLE IF NOT EXISTS chat_mutes (
        id         TEXT PRIMARY KEY,
        scope      TEXT NOT NULL,
        target     TEXT NOT NULL,
        reason     TEXT NOT NULL DEFAULT '',
        until      TEXT,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_mutes_target ON chat_mutes(target, scope);

      INSERT OR IGNORE INTO chat_rooms (id, slug, name, topic, kind, sort, created_by, created_at)
        VALUES ('room-lobby', 'lobby', '大厅', '所有人都在这里聊天', 'system', 10, NULL, datetime('now'));
      INSERT OR IGNORE INTO chat_rooms (id, slug, name, topic, kind, sort, created_by, created_at)
        VALUES ('room-random', 'random', '随便聊聊', '今天摸鱼了吗', 'public', 20, NULL, datetime('now'));
      INSERT OR IGNORE INTO chat_rooms (id, slug, name, topic, kind, sort, created_by, created_at)
        VALUES ('room-help', 'help', '求助问答', '遇到问题先问这里', 'public', 30, NULL, datetime('now'));
      INSERT OR IGNORE INTO chat_rooms (id, slug, name, topic, kind, sort, created_by, created_at)
        VALUES ('room-dev', 'dev', '开发交流', '一起把 Hub 做得更好', 'public', 40, NULL, datetime('now'));
    `,
  },
];

function currentVersion() {
  try {
    db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  } catch {
    return 0;
  }
  return db.prepare('SELECT COUNT(*) AS c FROM _migrations').get().c;
}

export function migrate() {
  // 先确保迁移记录表存在，再读取已应用的版本
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => r.name));
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
        m.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
      logger.info(`迁移已应用：${m.name}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/* ---------- 查询助手 ---------- */

export function all(sql, params = []) {
  return db.prepare(sql).all(...params).map(plain);
}

export function get(sql, params = []) {
  const row = db.prepare(sql).get(...params);
  return row ? plain(row) : null;
}

export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function plain(row) {
  return { ...row };
}

export function getSetting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    JSON.stringify(value),
  ]);
}

export default db;
