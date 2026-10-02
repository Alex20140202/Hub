/**
 * 迁移列表：按数组顺序执行，已应用的记录写入 `_migrations`，重复启动不会重复建表。
 * 新增结构请追加新条目（如 { name: '002_xxx', up: '...' }），不要修改已发布条目。
 */
export const migrations = [
  {
    name: '001_core',
    up: `
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        username      TEXT NOT NULL UNIQUE,
        nickname      TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user',
        bio           TEXT NOT NULL DEFAULT '',
        avatar_hue    INTEGER NOT NULL DEFAULT 210,
        theme         TEXT NOT NULL DEFAULT 'auto',
        accent        TEXT NOT NULL DEFAULT 'indigo',
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE sessions (
        id            TEXT PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_agent    TEXT NOT NULL DEFAULT '',
        ip            TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at    TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE notes (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL DEFAULT '',
        body       TEXT NOT NULL DEFAULT '',
        tags       TEXT NOT NULL DEFAULT '',
        color      TEXT NOT NULL DEFAULT 'slate',
        pinned     INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_notes_user ON notes(user_id, pinned DESC, updated_at DESC);

      CREATE TABLE todos (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title        TEXT NOT NULL,
        detail       TEXT NOT NULL DEFAULT '',
        priority     TEXT NOT NULL DEFAULT 'normal',
        done         INTEGER NOT NULL DEFAULT 0,
        due_at       TEXT,
        position     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE INDEX idx_todos_user ON todos(user_id, done, position);

      CREATE TABLE links (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        url         TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tags        TEXT NOT NULL DEFAULT '',
        starred     INTEGER NOT NULL DEFAULT 0,
        clicks      INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_links_user ON links(user_id, starred DESC, created_at DESC);

      CREATE TABLE files (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        stored_name  TEXT NOT NULL,
        mime         TEXT NOT NULL DEFAULT 'application/octet-stream',
        size         INTEGER NOT NULL DEFAULT 0,
        folder       TEXT NOT NULL DEFAULT '默认',
        is_public    INTEGER NOT NULL DEFAULT 0,
        downloads    INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_files_user ON files(user_id, created_at DESC);

      CREATE TABLE events (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL,
        target     TEXT NOT NULL DEFAULT '',
        meta       TEXT NOT NULL DEFAULT '',
        day        TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_events_user_day ON events(user_id, day DESC);

      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    name: '002_site_branding',
    up: `
      INSERT OR IGNORE INTO settings (key, value) VALUES ('site_name', 'Hub 超级中心');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('site_tagline', '一处收纳你的笔记、待办、书签与文件');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('allow_registration', 'true');
    `,
  },
];
