/**
 * 迁移列表：按数组顺序执行，已应用的记录写入 `_migrations`，重复启动不会重复建表。
 * 新增结构请追加新条目（如 { name: '010_xxx', up: '...' }），不要修改已发布条目。
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
  {
    name: '003_blog',
    up: `
      CREATE TABLE categories (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        slug        TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        position    INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE tags (
        id   INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE
      );

      CREATE TABLE posts (
        id           INTEGER PRIMARY KEY,
        author_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        title        TEXT NOT NULL,
        slug         TEXT NOT NULL UNIQUE,
        excerpt      TEXT NOT NULL DEFAULT '',
        body         TEXT NOT NULL DEFAULT '',
        cover_hue    INTEGER NOT NULL DEFAULT 220,
        status       TEXT NOT NULL DEFAULT 'published',
        featured     INTEGER NOT NULL DEFAULT 0,
        views        INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        published_at TEXT
      );
      CREATE INDEX idx_posts_status ON posts(status, published_at DESC);
      CREATE INDEX idx_posts_author ON posts(author_id, status);

      CREATE TABLE post_tags (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, tag_id)
      );
      CREATE INDEX idx_post_tags_tag ON post_tags(tag_id);

      CREATE TABLE comments (
        id         INTEGER PRIMARY KEY,
        post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        parent_id  INTEGER REFERENCES comments(id) ON DELETE CASCADE,
        guest_name TEXT NOT NULL DEFAULT '',
        body       TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'approved',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_comments_post ON comments(post_id, status, created_at);

      CREATE TABLE reactions (
        id          INTEGER PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id   INTEGER NOT NULL,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (target_type, target_id, user_id)
      );

      CREATE TABLE bookmarks (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (user_id, post_id)
      );
    `,
  },
  {
    name: '004_shortlinks',
    up: `
      CREATE TABLE short_links (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code       TEXT NOT NULL UNIQUE,
        target_url TEXT NOT NULL,
        title      TEXT NOT NULL DEFAULT '',
        clicks     INTEGER NOT NULL DEFAULT 0,
        active     INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_shorts_user ON short_links(user_id, created_at DESC);
    `,
  },
  {
    name: '005_points',
    up: `
      ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE point_logs (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        delta      INTEGER NOT NULL,
        balance    INTEGER NOT NULL,
        reason     TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_point_logs_user ON point_logs(user_id, id DESC);

      CREATE TABLE checkins (
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day        TEXT NOT NULL,
        streak     INTEGER NOT NULL DEFAULT 1,
        reward     INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, day)
      );

      CREATE TABLE shop_items (
        id          INTEGER PRIMARY KEY,
        sku         TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        kind        TEXT NOT NULL,
        cost        INTEGER NOT NULL,
        stock       INTEGER,
        sold        INTEGER NOT NULL DEFAULT 0,
        payload     TEXT NOT NULL DEFAULT '',
        active      INTEGER NOT NULL DEFAULT 1,
        position    INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE user_items (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id    INTEGER NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
        used       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_user_items ON user_items(user_id, used);
    `,
  },
  {
    name: '006_chat',
    up: `
      CREATE TABLE messages (
        id        INTEGER PRIMARY KEY,
        room      TEXT NOT NULL DEFAULT 'lobby',
        user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        nickname  TEXT NOT NULL,
        kind      TEXT NOT NULL DEFAULT 'chat',
        body      TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_messages_room ON messages(room, id DESC);
    `,
  },
  {
    name: '007_community',
    up: `
      ALTER TABLE users ADD COLUMN frame TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN badges TEXT NOT NULL DEFAULT '';

      CREATE TABLE subscribers (
        id         INTEGER PRIMARY KEY,
        email      TEXT NOT NULL UNIQUE,
        active     INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    name: '008_chat_rooms',
    up: `
      CREATE TABLE rooms (
        id         INTEGER PRIMARY KEY,
        code       TEXT NOT NULL UNIQUE,
        name       TEXT NOT NULL,
        type       TEXT NOT NULL DEFAULT 'group',
        topic      TEXT NOT NULL DEFAULT '',
        owner_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        avatar_hue INTEGER NOT NULL DEFAULT 210,
        is_public  INTEGER NOT NULL DEFAULT 1,
        max_members INTEGER NOT NULL DEFAULT 50,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_rooms_type ON rooms(type, id);

      CREATE TABLE room_members (
        room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role       TEXT NOT NULL DEFAULT 'member',
        last_read  TEXT NOT NULL DEFAULT (datetime('now')),
        joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (room_id, user_id)
      );
      CREATE INDEX idx_room_members_user ON room_members(user_id);

      -- 消息可挂一个附件（聊天文件传输）
      ALTER TABLE messages ADD COLUMN attachment_id INTEGER REFERENCES files(id) ON DELETE SET NULL;

      -- 私聊线程：两人组合的确定性标识，保证 A→B 与 B→A 落到同一房间
      CREATE TABLE dm_threads (
        id          INTEGER PRIMARY KEY,
        code        TEXT NOT NULL UNIQUE,
        user_a      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_b      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_dm_user_a ON dm_threads(user_a);
      CREATE INDEX idx_dm_user_b ON dm_threads(user_b);

      -- 私聊已读水位（群聊用 room_members.last_read）
      CREATE TABLE dm_reads (
        thread_id INTEGER NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
        user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (thread_id, user_id)
      );
    `,
  },
  {
    name: '009_cosmetics',
    up: `
      -- 商城装饰：兑换后装备在这里，站点各处据此渲染
      -- 注：frame / badges 已在 007_community 中加入，这里只补新的几列
      ALTER TABLE users ADD COLUMN skin TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN title TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN storage_bonus INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    name: '010_chat_v2',
    up: `
      -- 消息可回复另一条（引用）
      ALTER TABLE messages ADD COLUMN reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL;
      -- 房间级置顶（群公告）：同一房间最多一条
      ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_messages_pinned ON messages(room, pinned DESC, id DESC);

      -- 成员免打扰
      ALTER TABLE room_members ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;

      -- 消息已读回执：谁在什么时候看过
      CREATE TABLE message_reads (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        read_at    TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (message_id, user_id)
      );
      CREATE INDEX idx_message_reads_user ON message_reads(user_id);

      CREATE INDEX idx_messages_room_id ON messages(room, id);
    `,
  },
];
