import { get, run, tx } from '../db.js';
import { hashPassword } from '../lib/password.js';
import { config } from '../config.js';
import { createUser, findByEmail } from './users.js';
import { createNote } from './notes.js';
import { createLink } from './links.js';
import { createTodo } from './todos.js';
import { createPost, createComment, ensureTag, listCategories, createCategory, toggleReaction, updatePost } from './posts.js';
import { createShort } from './shorts.js';
import { addMessage, subscribe } from './chat.js';
import { upsertItem, award, balanceOf, listShopItems, equipOwned } from './points.js';
import * as rooms from './rooms.js';
import { recordEvent } from './stats.js';

/** 相对今天偏移若干天的日期字符串。 */
const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

/** 把某一行的时间往前挪，模拟历史内容。必须带 where，否则会改到整张表。 */
const backdate = (table, column, days, where = '', params = []) =>
  run(`UPDATE ${table} SET ${column} = datetime('now', ?) ${where}`, `-${days} days`, ...params);

/* --------------------------------- 商城道具 --------------------------------- */

const SHOP_ITEMS = [
  /* --------------------------------- 主题皮肤 --------------------------------- */
  { sku: 'skin-default', name: '经典靛蓝', description: '本站默认配色，永不过时。', kind: 'skin', cost: 0, stock: null, payload: '', position: 1 },
  { sku: 'skin-ocean', name: '深海之息', description: '整站切换为冷调海洋蓝，与明暗模式自由组合。', kind: 'skin', cost: 300, stock: null, payload: 'ocean', position: 2 },
  { sku: 'skin-forest', name: '苔原微光', description: '低饱和绿意配色，长时间阅读更护眼。', kind: 'skin', cost: 300, stock: null, payload: 'forest', position: 3 },
  { sku: 'skin-dusk', name: '黄昏暖阳', description: '暖橙渐变，适合夜里浏览。', kind: 'skin', cost: 420, stock: null, payload: 'dusk', position: 4 },
  { sku: 'skin-sakura', name: '樱色信笺', description: '淡粉与米白，写文章时很舒服。', kind: 'skin', cost: 480, stock: 30, payload: 'sakura', position: 5 },
  { sku: 'skin-mono', name: '黑白极简', description: '去掉一切装饰色，只留层次与留白。', kind: 'skin', cost: 200, stock: null, payload: 'mono', position: 6 },
  { sku: 'skin-mint', name: '薄荷气泡', description: '青绿撞色，年轻一点。', kind: 'skin', cost: 360, stock: 40, payload: 'mint', position: 7 },
  { sku: 'skin-grape', name: '夜幕葡萄', description: '深紫渐变，配合深色模式极佳。', kind: 'skin', cost: 520, stock: 25, payload: 'grape', position: 8 },

  /* --------------------------------- 头像框 --------------------------------- */
  { sku: 'frame-none', name: '素框', description: '默认无边框。', kind: 'frame', cost: 0, stock: null, payload: '', position: 9 },
  { sku: 'frame-gold', name: '鎏金头像框', description: '个人中心与主页头像显示金色描边。', kind: 'frame', cost: 500, stock: 20, payload: 'gold', position: 10 },
  { sku: 'frame-neon', name: '霓虹头像框', description: '赛博风格发光描边，深色模式下更亮眼。', kind: 'frame', cost: 380, stock: 30, payload: 'neon', position: 11 },
  { sku: 'frame-aurora', name: '极光头像框', description: '青紫渐变流动边框，稀有外观。', kind: 'frame', cost: 760, stock: 12, payload: 'aurora', position: 12 },
  { sku: 'frame-dashed', name: '虚线徽章框', description: '低调的虚线描边，几乎不抢视觉。', kind: 'frame', cost: 240, stock: null, payload: 'dashed', position: 13 },

  /* ---------------------------------- 称号 ---------------------------------- */
  { sku: 'title-newbie', name: '「新鲜出炉」', description: '新用户专属称号，展示在昵称旁。', kind: 'title', cost: 0, stock: null, payload: '新鲜出炉', position: 14 },
  { sku: 'title-pioneer', name: '「开拓者」', description: '站内第一批内容创作者。', kind: 'title', cost: 150, stock: null, payload: '开拓者', position: 15 },
  { sku: 'title-collector', name: '「收藏家」', description: '广受认可的优质作者。', kind: 'title', cost: 300, stock: 50, payload: '收藏家', position: 16 },
  { sku: 'title-nightowl', name: '「夜猫子」', description: '总在深夜发布内容。', kind: 'title', cost: 260, stock: 60, payload: '夜猫子', position: 17 },
  { sku: 'title-archivist', name: '「资料管理员」', description: '把知识整理得井井有条。', kind: 'title', cost: 420, stock: 40, payload: '资料管理员', position: 18 },
  { sku: 'title-og', name: '「 founding 成员」', description: '开站即在的元老，限量 10 份。', kind: 'title', cost: 999, stock: 10, payload: '创始成员', position: 19 },

  /* ---------------------------------- 勋章 ---------------------------------- */
  { sku: 'badge-pioneer', name: '开拓者勋章', description: '纪念你在 Hub 上留下的第一批内容。', kind: 'badge', cost: 150, stock: null, payload: 'pioneer', position: 20 },
  { sku: 'badge-collector', name: '收藏家勋章', description: '展示在个人中心的勋章墙。', kind: 'badge', cost: 260, stock: 40, payload: 'collector', position: 21 },
  { sku: 'badge-builder', name: '建设者勋章', description: '为社区提交过反馈或建议。', kind: 'badge', cost: 320, stock: 30, payload: 'builder', position: 22 },
  { sku: 'badge-scholar', name: '学者勋章', description: '你的文章被很多人在读。', kind: 'badge', cost: 450, stock: 25, payload: 'scholar', position: 23 },

  /* -------------------------------- 存储扩容 -------------------------------- */
  { sku: 'storage-50', name: '存储扩容 +50MB', description: '永久提高你的存储配额上限。', kind: 'storage', cost: 220, stock: 50, payload: '52428800', position: 24 },
  { sku: 'storage-200', name: '存储扩容 +200MB', description: '大文件用户的选择。', kind: 'storage', cost: 700, stock: 20, payload: '209715200', position: 25 },
  { sku: 'storage-500', name: '存储扩容 +500MB', description: '一次性解决空间焦虑。', kind: 'storage', cost: 1500, stock: 8, payload: '524288000', position: 26 },

  /* ------------------------------- 一次性道具 ------------------------------- */
  { sku: 'rename-ticket', name: '用户名改名券', description: '在「我的道具」中手动使用，可修改一次用户名。', kind: 'consumable', cost: 180, stock: 15, payload: 'rename', position: 27 },
  { sku: 'boost-card', name: '文章置顶卡', description: '让一篇文章在首页「精选」多显示一周。', kind: 'consumable', cost: 240, stock: 30, payload: 'boost', position: 28 },
  { sku: 'lucky-cookie', name: '幸运Cookie', description: '随机获得 50-300 积分。', kind: 'consumable', cost: 100, stock: null, payload: 'lucky', position: 29 },
];

function seedShop() {
  if (listShopItems().length) return;
  for (const item of SHOP_ITEMS) upsertItem(item);
}

/* --------------------------------- 演示账号 --------------------------------- */

const ensureUser = (spec) => {
  const existing = findByEmail(spec.email);
  if (existing) return existing;
  const user = createUser({
    email: spec.email,
    username: spec.username,
    nickname: spec.nickname,
    passwordHash: hashPassword(spec.password),
    role: spec.role ?? 'user',
  });
  run('UPDATE users SET bio = ? WHERE id = ?', spec.bio ?? '', user.id);
  recordEvent(user.id, 'user.register', '注册账号');
  return findByEmail(spec.email);
};

/* ---------------------------------- 内容 ---------------------------------- */

const ARTICLES = [
  {
    author: 'admin',
    title: '用 Node.js 从零搭一个零依赖的博客系统',
    category: '技术',
    tags: ['Node.js', '架构', '零依赖'],
    featured: 1,
    views: 1284,
    days: 12,
    body: `这篇讲清楚一件事：**不装任何 npm 包**，能不能写出一个能用的博客。

## 运行时选型

- \`node:http\` 起服务并处理路由
- \`node:sqlite\` 做持久化（Node 22.5+ 内置）
- \`node:crypto\` 的 scrypt 负责密码哈希，HMAC 负责会话签名
- 前端用浏览器原生 ES Module，不需要打包器

> 零依赖不是炫技，而是把「出问题时的排查面」压到最小。

## 路由怎么设计

用 History API 而不是 hash 路由，这样服务端才知道当前路径，能直接渲染对应页面：

\`\`\`js
router.get('/blog/:slug', async (ctx) => {
  const post = findPost(ctx.params.slug);
  if (!post) throw notFound('文章不存在');
  return render(res, { post });
});
\`\`\`

## 服务端是唯一渲染源

同一个页面不在前后端各写一遍。首屏服务端输出完整 HTML，客户端换页时只请求片段：

| 场景 | 请求 | 响应 |
| --- | --- | --- |
| 首屏 | \`GET /blog\` | 完整 HTML |
| 换页 | \`GET /blog?_partial=1\` | 片段 HTML |
| 写操作 | \`POST /api/posts\` | JSON |

这样避免了视图逻辑在两端漂移——加一个按钮只需要改一处。

## 踩过的坑

1. 数据库时间用 \`datetime('now')\` 是 UTC，格式化前要按 UTC 解析
2. 上传文件名一定要随机化，否则同名文件会互相覆盖
3. 限流要放在路由匹配**之前**，否则等于没生效`,
  },
  {
    author: 'admin',
    title: '把 CRUD 写成主流程：笔记、待办、书签的组织方式',
    category: '技术',
    tags: ['产品设计', '效率'],
    featured: 1,
    views: 862,
    days: 8,
    body: `个人工作台最容易失败的原因不是功能少，而是**信息没有归位**。

## 三个模块的边界

- **笔记**：想到什么记什么，不要求结构
- **待办**：一定要能完成，带截止时间
- **书签**：一定要能被搜到，带标签

边界清楚了之后，交互才简单：笔记只有「编辑 / 置顶」，待办只有「勾选 / 排序」，书签只有「标星 / 点击」。

## 每天的入口成本要低

- 首页直接给「接下来要做」和「最近笔记」
- 命令面板 \`⌘K\` 覆盖跳页和搜索
- 拖拽上传，不挑文件

## 完成反馈

勾选待办后不要立刻刷新整页，乐观更新 + 静默写回。用户不该为一次勾选等待网络。`,
  },
  {
    author: 'demo',
    title: '我的一周复盘模板',
    category: '方法',
    tags: ['复盘', '效率', '模板'],
    views: 431,
    days: 5,
    body: `每周五花十分钟，固定回答四个问题。

## 1. 这周完成了什么

只写**有产出**的，没产出的不写。

## 2. 什么卡住了

每条写清楚：卡在哪一步、需要谁、下一步动作是什么。

## 3. 下周最重要的三件事

不要超过三件。超过三件等于没有重点。

## 4. 要停止做什么

这一问最重要。停掉一件低价值的事，胜过新增三件。

> 复盘不是总结，是给下周的自己减负。`,
  },
  {
    author: 'demo',
    title: 'WebSocket 不用库也能写：帧格式与握手',
    category: '技术',
    tags: ['WebSocket', 'Node.js', '零依赖'],
    views: 967,
    days: 3,
    body: `很多人以为 WebSocket 必须依赖 \`ws\`，其实握手和帧格式都很简单。

## 握手

客户端发一个带 \`Sec-WebSocket-Key\` 的升级请求，服务端返回：

\`\`\`js
const accept = createHash('sha1')
  .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
  .digest('base64');
\`\`\`

## 帧结构

\`\`\`
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
|N|V|V|V|       |S|             |   (if payload len==126/127)   |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
\`\`\`

**客户端发来的帧必须掩码**，服务端发的不需要——这是最容易漏的一点。

## 心跳

用 ping/pong 帧（opcode 0x9 / 0xA）做保活，比在应用层发心跳包更省事。`,
  },
  {
    author: 'lin',
    title: '把长链接变短：短链服务的设计取舍',
    category: '技术',
    tags: ['短链', '设计'],
    views: 312,
    days: 2,
    body: `短链看着简单，坑不少。

## 短码怎么生成

- 纯随机：短但不可读
- 短码 + 冲突后缀：折中方案
- 内容哈希：短，但会泄露原地址

我选第三种里最保守的：随机短码 + 冲突时追加两位。

## 必须有的能力

- 点击统计（这是短链唯一比原链接强的地方）
- 停用而不是删除（误建了要能救）
- 自定义短码（自己人用着方便）

## 隐私

点击日志不要存 IP，只存次数和时间。短链经常带敏感参数。`,
  },
  {
    author: 'lin',
    title: '积分系统不是游戏化，而是给「有用的行为」定价',
    category: '方法',
    tags: ['产品设计', '积分'],
    views: 208,
    days: 1,
    body: `很多站点的积分只能看不能用，最后变成摆设。

## 先想清楚哪些行为值得激励

值得激励的行为有两个特征：

1. 对**别人**也有价值（发布文章、评论）
2. 需要**持续**付出（签到、创作）

不值得激励的是「点一下广告」这种。

## 每日上限必须有

没有上限的积分系统活不过一周。加签到、发布都设上限。

## 兑换的东西要立刻生效

兑换一个主题皮肤，如果还要手动「装备」才能看到，那体验就断了。`,
  },
];

const NOTES = [
  { title: 'Hub 使用手册', body: '⌘K 打开命令面板\ng + d/n/t/l/f 跳模块\n拖文件到文件页即可上传\n待办支持拖拽排序', tags: ['手册'], color: 'indigo', pinned: 1 },
  { title: '本周重点', body: '1. 把博客的评论审核跑通\n2. 短链加上停用功能\n3. 聊天室补一个 /who 指令', tags: ['计划'], color: 'emerald' },
  { title: '零依赖 Node 服务备忘', body: 'node:http 起服务\nnode:sqlite 存数据\nscrypt 哈希密码\ncreateHmac 签会话\n运行时不用 node_modules', tags: ['技术'], color: 'cyan' },
  { title: '灵感碎片', body: '命令行工具的输出应该能直接管道给下一个命令\n错误信息要告诉用户「怎么办」而不只是「错了」', tags: ['灵感'], color: 'amber' },
  { title: '要读的论文', body: '- Attention Is All You Need\n- The Tail at Scale\n- A Philosophy of Software Design', tags: ['阅读'], color: 'rose' },
];

const LINKS = [
  { title: 'Node.js 官方文档', url: 'https://nodejs.org/docs/latest/api/', description: '运行时与内置模块手册', tags: ['技术', '文档'], starred: 1 },
  { title: 'MDN Web Docs', url: 'https://developer.mozilla.org/zh-CN/', description: '前端 API 中文文档', tags: ['技术', '文档'] },
  { title: 'Can I use', url: 'https://caniuse.com/', description: '浏览器兼容性速查', tags: ['技术', '工具'], starred: 1 },
  { title: 'Hacker News', url: 'https://news.ycombinator.com/', description: '技术圈资讯', tags: ['资讯'] },
  { title: 'GitHub Trending', url: 'https://github.com/trending', description: '看看大家在做什么', tags: ['技术', '资讯'] },
  { title: 'SQLite 文档', url: 'https://www.sqlite.org/docs.html', description: '数据库底层能力', tags: ['技术', '文档'] },
];

const TODOS = [
  { title: '给评论加上审核队列', detail: '游客评论进 pending，登录用户直接放行', priority: 'high', dueAt: `${day(0)} 20:00` },
  { title: '写完短链模块的测试', detail: '覆盖冲突、停用、跳转', priority: 'high', dueAt: `${day(1)} 18:00` },
  { title: '整理个人主页样式', detail: '头像、简介、文章列表', priority: 'normal', dueAt: `${day(3)} 12:00` },
  { title: '清理失效书签', detail: '把三个月没点过的归档', priority: 'low' },
  { title: '给聊天室加 /who 指令', detail: '', priority: 'normal' },
];

const CHAT_SEED = [
  { nick: '系统', kind: 'system', body: '聊天室已就绪，发送 /help 查看指令' },
  { nick: '演示用户', body: '有人也在研究零依赖 Node 吗' },
  { nick: '林小满', body: '我在看 WebSocket 的帧格式，其实不难' },
  { nick: '管理员', body: '欢迎大家，这站点刚搭起来' },
  { nick: '演示用户', body: '博客的 Markdown 渲染挺好用的' },
  { nick: '林小满', kind: 'action', body: '点了收藏' },
  { nick: '管理员', body: '积分中心上线了，签到可以领积分换主题皮肤' },
];

const SHORTS = [
  { title: 'Node.js 下载', target: 'https://nodejs.org/zh-cn/download' },
  { title: 'SQLite 文档', target: 'https://www.sqlite.org/docs.html' },
  { title: 'MDN CSS 文档', target: 'https://developer.mozilla.org/zh-CN/docs/Web/CSS' },
];

/* ---------------------------------- 执行 ---------------------------------- */

export function seed() {
  seedShop();

  const admin = ensureUser({
    email: config.adminEmail,
    username: 'admin',
    nickname: '管理员',
    password: config.adminPassword,
    role: 'admin',
    bio: '维护这个站点。喜欢把复杂的东西做简单。',
  });

  const demo = ensureUser({
    email: config.demoEmail,
    username: 'demo',
    nickname: '演示用户',
    password: config.demoPassword,
    bio: '产品经理，写点方法论和读书笔记。',
  });

  const lin = ensureUser({
    email: 'lin@hub.dev',
    username: 'lin',
    nickname: '林小满',
    password: 'linpass123',
    bio: '后端工程师，对数据库和协议有执念。',
  });

  ensureContent({ admin, demo, lin });
  return { admin, demo, lin };
}

function ensureContent({ admin, demo, lin }) {
  // 分类
  if (!listCategories().length) {
    createCategory('技术', '工程实践、协议拆解与踩坑记录');
    createCategory('方法', '工作流、复盘与思考方式');
  }
  const categoryByName = Object.fromEntries(listCategories().map((item) => [item.name, item.id]));

  // 文章
  if (get('SELECT COUNT(*) AS n FROM posts').n === 0) {
    // createPost 自带事务，这里不能再开外层事务（SQLite 不支持嵌套 BEGIN）
    for (const article of ARTICLES) {
      const author = { admin, demo, lin }[article.author];
      const post = createPost(author.id, {
        title: article.title,
        body: article.body,
        tags: article.tags,
        categoryId: categoryByName[article.category],
        status: 'published',
        coverHue: Math.floor(Math.random() * 360),
      });
      run('UPDATE posts SET views = ?, featured = ? WHERE id = ?', article.views, article.featured ?? 0, post.id);
      backdate('posts', 'created_at', article.days, 'WHERE id = ?', [post.id]);
      backdate('posts', 'updated_at', article.days, 'WHERE id = ?', [post.id]);
      backdate('posts', 'published_at', article.days, 'WHERE id = ?', [post.id]);
    }
  }

  // 评论 + 互动
  if (get('SELECT COUNT(*) AS n FROM comments').n === 0) {
    const article = get("SELECT * FROM posts ORDER BY id LIMIT 1");
    const pool = [admin, demo, lin];
    const texts = [
      '写得很清楚，尤其是「服务端是唯一渲染源」那部分，我们踩过同样的坑。',
      '零依赖确实香，出问题时排查面小很多。',
      '想问一下，WebSocket 那篇里的掩码处理在生产上遇到过性能问题吗？',
      '收藏了，周末照着搭一个试试。',
      '积分系统的每日上限这个点很关键，我们站点就是没设上限被刷爆了。',
      '短链的冲突追加两位这个折中挺好的，实用。',
    ];
    texts.forEach((text, index) => {
      const post = get('SELECT id FROM posts ORDER BY id LIMIT 1 OFFSET ?', index % 3);
      const author = pool[index % pool.length];
      const created = createComment(post.id, { authorId: author.id, body: text });
      backdate('comments', 'created_at', index, 'WHERE id = ?', [created.id]);
      // 少量点赞与收藏，让数据看起来真实
      if (index % 2 === 0) toggleReaction('post', post.id, author.id);
    });
  }

  // 笔记 / 书签 / 待办
  for (const user of [demo, admin]) {
    if (get('SELECT COUNT(*) AS n FROM notes WHERE user_id = ?', user.id).n === 0) {
      for (const note of NOTES) createNote(user.id, note);
    }
    if (get('SELECT COUNT(*) AS n FROM links WHERE user_id = ?', user.id).n === 0) {
      for (const link of LINKS) createLink(user.id, link);
    }
    if (get('SELECT COUNT(*) AS n FROM todos WHERE user_id = ?', user.id).n === 0) {
      for (const todo of TODOS) createTodo(user.id, todo);
    }
  }

  // 短链
  if (get('SELECT COUNT(*) AS n FROM short_links').n === 0) {
    for (const short of SHORTS) createShort(admin.id, { targetUrl: short.target, title: short.title });
  }

  // 聊天室历史
  if (get('SELECT COUNT(*) AS n FROM messages').n === 0) {
    CHAT_SEED.forEach((message, index) => {
      const author = { 管理员: admin, 演示用户: demo, 林小满: lin }[message.nick];
      const saved = addMessage({
        userId: message.kind === 'system' ? null : (author?.id ?? null),
        nickname: message.nick,
        kind: message.kind,
        body: message.body,
      });
      backdate('messages', 'created_at', CHAT_SEED.length - index, 'WHERE id = ?', [saved.id]);
    });
  }

  // 积分：给演示账号一些流水，商城才有可用余额
  if (get('SELECT COUNT(*) AS n FROM point_logs').n === 0) {
    for (const user of [demo, admin, lin]) {
      for (const reason of ['user.register', 'post.publish', 'post.publish', 'comment.create', 'post.publish']) {
        award(user.id, reason, { note: '历史积分' });
      }
    }
    run("UPDATE point_logs SET created_at = datetime('now', '-5 days') WHERE reason = '历史积分'");
  }

  // 签到记录：让日历与连签看起来有内容
  if (get('SELECT COUNT(*) AS n FROM checkins').n === 0) {
    for (const user of [demo, admin, lin]) {
      for (let i = 6; i >= 1; i -= 1) {
        run(
          "INSERT OR IGNORE INTO checkins (user_id, day, streak, reward, created_at) VALUES (?, date('now', 'localtime', ?), ?, ?, datetime('now', ?))",
          user.id,
          `-${i} days`,
          7 - i,
          5,
          `-${i} days`,
        );
      }
    }
  }

  // 订阅者
  if (get('SELECT COUNT(*) AS n FROM subscribers').n === 0) {
    for (const mail of ['reader1@example.com', 'reader2@example.com']) subscribe(mail);
  }

  // 示例群聊与私聊，让聊天室开箱有内容
  if (get('SELECT COUNT(*) AS n FROM rooms').n === 0) {
    const front = rooms.createGroup(admin.id, { name: '前端摸鱼群', topic: '交流技术、吐槽需求', isPublic: true, maxMembers: 50, memberIds: [demo.id, lin.id] });
    rooms.createGroup(demo.id, { name: '读书会', topic: '每周一本书，输出一页笔记', isPublic: true, maxMembers: 30, memberIds: [lin.id] });
    const privateGroup = rooms.createGroup(lin.id, { name: '协议小组', topic: '只聊底层实现', isPublic: false, memberIds: [admin.id] });

    const seedRoomMessages = (code, list) => {
      list.forEach((entry, index) => {
        const who = { admin, demo, lin }[entry[0]];
        addMessage({ room: code, userId: entry[0] === 'system' ? null : (who?.id ?? null), nickname: entry[1], kind: entry[2] ?? 'chat', body: entry[3] });
        backdate('messages', 'created_at', list.length - index, 'WHERE room = ? AND id = (SELECT MAX(id) FROM messages)', [code]);
      });
    };

    seedRoomMessages(front.code, [
      ['admin', '管理员', 'system', '群已创建，欢迎大家'],
      ['lin', '林小满', 'chat', '有人在看 WebSocket 的帧格式吗'],
      ['demo', '演示用户', 'chat', '我也在看，掩码那段最容易踩坑'],
      ['admin', '管理员', 'chat', '客户端帧必须掩码，服务端不用，这个我踩过'],
      ['lin', '林小满', 'action', '记到笔记里了'],
      ['demo', '演示用户', 'chat', '积分中心的商城挺有意思，兑换皮肤立刻生效'],
    ]);

    const dm = rooms.openDm(demo.id, lin.id);
    seedRoomMessages(dm.room.code, [
      ['demo', '演示用户', 'chat', '那篇 WebSocket 的文章你看了吗'],
      ['lin', '林小满', 'chat', '看了，握手那段写得很清楚'],
      ['lin', '林小满', 'chat', '有空一起把短链那块也写了？'],
    ]);

    void privateGroup;
  }

  // 给演示账号发一套合理的外观（皮肤/框/称号各一件 + 两枚勋章 + 一次扩容），
  // 这样商城与个人中心开箱有内容可看，而不是把所有商品都塞给他
  if (get("SELECT COUNT(*) AS n FROM user_items").n === 0) {
    const wanted = ['skin-grape', 'frame-dashed', 'title-og', 'badge-pioneer', 'badge-scholar', 'storage-50'];
    tx(() => {
      for (const sku of wanted) {
        const item = listShopItems().find((entry) => entry.sku === sku);
        if (!item) continue;
        run('INSERT INTO user_items (user_id, item_id) VALUES (?, ?)', demo.id, item.id);
        run('UPDATE shop_items SET sold = sold + 1 WHERE id = ?', item.id);
        equipOwned(demo.id, item);
      }
      // 直接把余额抬到 420，同时补一条流水，保证「累计赚取」与余额自洽
      const before = balanceOf(demo.id);
      run('UPDATE users SET points = 420 WHERE id = ?', demo.id);
      run(
        'INSERT INTO point_logs (user_id, delta, balance, reason) VALUES (?, ?, ?, ?)',
        demo.id,
        420 - before,
        420,
        '历史积分（演示数据）',
      );
    });
  }

  // 活动事件：让仪表盘趋势图有内容
  if (get("SELECT COUNT(*) AS n FROM events WHERE kind = 'note.create'").n === 0) {
    for (const user of [demo, admin]) {
      for (let i = 9; i >= 1; i -= 1) {
        recordEvent(user.id, 'note.create', '示例笔记');
        const last = get('SELECT MAX(id) AS id FROM events').id;
        run("UPDATE events SET day = date('now', 'localtime', ?) WHERE id = ?", `-${i} days`, last);
      }
    }
  }
}

export const needsSeed = () => !get('SELECT 1 AS ok FROM users LIMIT 1');
export { balanceOf, updatePost, ensureTag };
