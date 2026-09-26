import { all, get, run } from '../db.js';
import { randomId, slugify, nowIso } from '../lib/id.js';
import { hashPassword } from '../lib/password.js';
import config from '../config.js';

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export function seedIfEmpty() {
  const created = {};

  if (get('SELECT id FROM users LIMIT 1')) return created;

  // 管理员
  const adminId = randomId(10);
  run(
    `INSERT INTO users (id, username, email, password, role, nickname, bio, avatar_color, created_at, last_login)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      adminId,
      'admin',
      config.admin.email,
      hashPassword(config.admin.password),
      'admin',
      '站长',
      '这个站点的管理员。',
      AVATAR_COLORS[0],
      nowIso(),
      nowIso(),
    ],
  );
  created.admin = { id: adminId, email: config.admin.email, password: config.admin.password };

  const demoId = randomId(10);
  run(
    `INSERT INTO users (id, username, email, password, role, nickname, bio, avatar_color, created_at, last_login)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      demoId,
      'demo',
      'demo@hub.dev',
      hashPassword('demo12345'),
      'user',
      '示例用户',
      '这是用于体验的演示账号。',
      AVATAR_COLORS[2],
      nowIso(),
      nowIso(),
    ],
  );
  created.demo = { id: demoId, email: 'demo@hub.dev', password: 'demo12345' };

  // 分类
  const cats = [
    ['技术分享', 'tech', '工程实践、源码解读与踩坑记录', '#6366f1'],
    ['产品思考', 'product', '从 0 到 1 的产品设计与增长', '#0ea5e9'],
    ['生活随笔', 'life', '读书、旅行与日常记录', '#f59e0b'],
  ];
  const catIds = {};
  for (const [name, slug, description, color] of cats) {
    const id = randomId(8);
    run('INSERT INTO categories (id, name, slug, description, color, created_at) VALUES (?,?,?,?,?,?)', [
      id,
      name,
      slug,
      description,
      color,
      nowIso(),
    ]);
    catIds[slug] = id;
  }

  const tagNames = ['Node.js', 'Web', '性能优化', '工程化', '数据库', '随笔'];
  const tagIds = {};
  for (const name of tagNames) {
    const id = randomId(8);
    run('INSERT INTO tags (id, name, slug, color, created_at) VALUES (?,?,?,?,?)', [
      id,
      name,
      slugify(name, 'tag'),
      null,
      nowIso(),
    ]);
    tagIds[name] = id;
  }

  const posts = [
    {
      title: '用 Node.js 从零搭建一个全栈站点',
      category: 'tech',
      tags: ['Node.js', 'Web', '工程化'],
      status: 'published',
      featured: 1,
      content: `## 为什么要自己搭一个

现成的 CMS 很多，但真正动手写一遍，才能理解请求从浏览器到数据库的完整链路。

## 技术选型

| 层 | 方案 | 理由 |
| --- | --- | --- |
| 运行时 | Node.js | 原生 HTTP + WebSocket，零依赖 |
| 存储 | node:sqlite | 单文件、免安装、事务完备 |
| 前端 | 原生 ESM | 不需要构建步骤，改完刷新即可 |

## 最小可用的 HTTP 服务

\`\`\`js
import { createServer } from 'node:http';

createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}).listen(3000);
\`\`\`

三行代码，一个服务就跑起来了。没有 express，没有 webpack，也没有配置文件。

## 下一步

- 路由与中间件
- 鉴权与会话
- 静态资源与缓存策略`,
    },
    {
      title: 'SQLite 在小型项目里被严重低估了',
      category: 'tech',
      tags: ['数据库', '性能优化'],
      status: 'published',
      featured: 0,
      content: `很多人一提数据库就想到 Postgres 和 Redis，但单文件 SQLite 才是绝大多数项目的最优解。

## 优势

1. 零运维：整个数据库就是一个文件
2. 单机性能惊人：WAL 模式下读写可以并行
3. 事务完备：ACID 全支持

## 什么时候不该用

- 需要多机写入
- 单表超过亿级数据
- 需要在线 schema 变更

> 结论：先跑起来，再谈扩容。`,
    },
    {
      title: '一个产品从想法到上线的 7 天',
      category: 'product',
      tags: ['随笔'],
      status: 'published',
      featured: 0,
      content: `## Day 1：写下唯一一句话

如果一句话说不清楚要做什么，就还没想清楚。

## Day 3：能被陌生人用起来

内测用户不超过 5 个，能跑通核心流程就够。

## Day 7：上线与复盘

上线不是终点。把用户反馈按频次排序，找到最高频的那一个抱怨，先修它。`,
    },
    {
      title: '深夜代码与红烧肉',
      category: 'life',
      tags: ['随笔'],
      status: 'draft',
      featured: 0,
      content: `这篇还没写完，先占个坑。

TODO:
- [ ] 补一张照片
- [x] 回忆一下当时在调什么 bug
- [ ] 写结论`,
    },
  ];

  const now = Date.now();
  const postIds = [];
  posts.forEach((p, idx) => {
    const id = randomId(10);
    postIds.push(id);
    const words = p.content.replace(/[`#>|*-]/g, ' ').split(/\s+/).filter(Boolean).length;
    run(
      `INSERT INTO posts
        (id, title, slug, excerpt, content, cover, author_id, category_id, status, featured, views, likes, reading_time, published_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        p.title,
        `${slugify(p.title, 'post')}-${randomId(4)}`,
        p.content.replace(/[#*`>|\n]/g, ' ').trim().slice(0, 90),
        p.content,
        null,
        idx % 2 === 0 ? adminId : demoId,
        catIds[p.category] || null,
        p.status,
        p.featured,
        120 - idx * 17,
        8 - idx * 2,
        Math.max(1, Math.round(words / 320)),
        p.status === 'published' ? new Date(now - idx * 86400000).toISOString() : null,
        new Date(now - (idx + 2) * 86400000).toISOString(),
        new Date(now - idx * 3600000).toISOString(),
      ],
    );
    for (const t of p.tags) {
      if (tagIds[t]) run('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?,?)', [id, tagIds[t]]);
    }
  });

  // 评论
  const commentBodies = [
    '写得很清楚，收藏了。',
    '第二步能不能展开讲讲中间件的设计？',
    '实战价值很高，希望多来几篇。',
  ];
  commentBodies.forEach((body, i) => {
    run(
      `INSERT INTO comments (id, post_id, author_id, parent_id, body, guest_name, ip_hash, status, likes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        randomId(10),
        postIds[0],
        i % 2 === 0 ? demoId : null,
        null,
        body,
        i % 2 === 0 ? null : '路过的人',
        null,
        'published',
        i,
        new Date(now - (i + 1) * 3600000).toISOString(),
      ],
    );
  });

  // 笔记
  const notes = [
    ['会议纪要 · 周会', '1. 登录接口加限流\n2. 短链增加自定义后缀\n3. 移动端表格横向滚动', 'blue', 1, ['会议']],
    ['想读的书', '《数据密集型应用系统设计》\n《重构》第 2 版', 'green', 0, ['阅读']],
    ['购物清单', '咖啡豆、牛奶、面包、鸡蛋', 'orange', 0, ['生活']],
  ];
  for (const [title, content, color, pinned, tags] of notes) {
    run(
      `INSERT INTO notes (id, user_id, title, content, color, pinned, tags, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        randomId(10),
        adminId,
        title,
        content,
        color,
        pinned,
        JSON.stringify(tags),
        nowIso(),
        nowIso(),
      ],
    );
  }

  // 待办
  const todos = [
    ['补齐 API 文档', '用 README 表格列全部接口', 1, 0, null, 'Hub'],
    ['移动端适配聊天页', '消息气泡在小屏会溢出', 2, 0, new Date(now + 86400000).toISOString(), 'Hub'],
    ['给编辑器加快捷键', 'Cmd+S 保存、Cmd+K 插入链接', 3, 0, null, 'Hub'],
    ['重构限流中间件', null, 3, 1, null, '基建'],
    ['写一篇 WebSocket 实战', null, 2, 0, new Date(now + 3 * 86400000).toISOString(), '内容'],
  ];
  todos.forEach((t, i) => {
    run(
      `INSERT INTO todos (id, user_id, title, detail, priority, done, due_at, project, position, created_at, completed_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        randomId(10),
        adminId,
        t[0],
        t[1],
        t[2],
        t[3],
        t[4],
        t[5],
        i,
        nowIso(),
        t[3] ? nowIso() : null,
        nowIso(),
      ],
    );
  });

  // 书签
  const links = [
    ['Node.js 官方文档', 'https://nodejs.org/docs/latest/api/', '内置能力比想象中多', ['docs'], 'dev'],
    ['SQLite 论坛', 'https://sqlite.org/forum/', 'WAL 与并发讨论', ['db'], 'dev'],
    ['MDN Web Docs', 'https://developer.mozilla.org/zh-CN/', '前端 API 权威参考', ['docs', 'frontend'], 'dev'],
    ['阮一峰的网络日志', 'https://www.ruanyifeng.com/blog/', '中文技术博客经典', ['blog'], 'read'],
  ];
  for (const [title, url, note, tags, category] of links) {
    run(
      `INSERT INTO links (id, user_id, title, url, note, tags, category, clicks, starred, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [randomId(10), adminId, title, url, note, JSON.stringify(tags), category, Math.floor(Math.random() * 40), Math.random() > 0.5 ? 1 : 0, nowIso(), nowIso()],
    );
  }

  // 短链
  const shorts = [
    ['nodejs', 'https://nodejs.org', 'Node.js 官网'],
    ['sqlite', 'https://sqlite.org', 'SQLite 官网'],
  ];
  for (const [code, target, title] of shorts) {
    run(
      `INSERT INTO short_links (id, code, target, title, user_id, clicks, active, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [randomId(10), code, target, title, adminId, Math.floor(Math.random() * 200), 1, nowIso()],
    );
  }

  // 聊天室历史
  const chats = [
    ['admin', '欢迎来到 Hub 聊天室，Node 原生 WebSocket，无第三方依赖 🚀'],
    ['demo', '收到！消息居然这么快。'],
    ['admin', '试试 /help 看看有什么指令。'],
  ];
  chats.forEach(([nickname, body], i) => {
    run(
      `INSERT INTO messages (id, room, user_id, nickname, kind, body, created_at) VALUES (?,?,?,?,?,?,?)`,
      [randomId(10), 'lobby', i === 0 ? adminId : demoId, nickname, 'chat', body, new Date(now - (chats.length - i) * 300000).toISOString()],
    );
  });

  return created;
}

/** 事件埋点（用于仪表盘趋势图） */
export function track(type, { userId = null, target = null, meta = null } = {}) {
  run('INSERT INTO events (id, user_id, type, target, meta, created_at) VALUES (?,?,?,?,?,?)', [
    randomId(10),
    userId,
    type,
    target,
    meta ? JSON.stringify(meta) : null,
    nowIso(),
  ]);
}

export function dailySeries(days = 14, type = null) {
  const rows = all(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c
     FROM events
     WHERE created_at >= datetime('now', ?)
     ${type ? 'AND type = ?' : ''}
     GROUP BY day ORDER BY day`,
    type ? [`-${days} days`, type] : [`-${days} days`],
  );
  const map = new Map(rows.map((r) => [r.day, r.c]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, count: map.get(key) || 0 });
  }
  return out;
}
