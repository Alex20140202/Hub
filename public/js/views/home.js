import { el, clear } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { StatsAPI, PostAPI } from '../lib/api.js';
import { numberFmt, timeAgo, dateShort } from '../lib/format.js';
import { avatar, empty, badge, skeleton } from '../ui/components.js';
import { lineChart } from '../ui/chart.js';

const MODULES = [
  { icon: '📝', title: '博客系统', desc: 'Markdown 写作、分类标签、评论嵌套、草稿与定时发布、阅读量统计。', href: '#/blog' },
  { icon: '📓', title: '灵感笔记', desc: '瀑布流速记，彩色便签、置顶与归档，标签化整理。', href: '#/notes' },
  { icon: '✅', title: '待办清单', desc: '优先级、截止时间、项目分组与完成率统计。', href: '#/todos' },
  { icon: '🔖', title: '书签收藏', desc: '分类归档、标签云与点击计数，favicon 自动抓取。', href: '#/links' },
  { icon: '🔗', title: '短链服务', desc: '自定义短码、点击统计、过期与停用控制。', href: '#/short' },
  { icon: '📁', title: '文件与图床', desc: '拖拽上传、目录归类、公开/私有与外链直链。', href: '#/files' },
  { icon: '💬', title: '实时聊天室', desc: '手写 WebSocket 协议实现，消息持久化与在线人数。', href: '#/chat' },
  { icon: '📊', title: '数据仪表盘', desc: '访问趋势、活跃热力图、内容排行与个人产出统计。', href: '#/dashboard' },
];

export default async function home(host) {
  const name = store.settings.site_name || 'Hub';
  const stats = await StatsAPI.overview().catch(() => null);
  const featured = await PostAPI.featured().catch(() => ({ items: [] }));

  clear(host);

  /* ---------- Hero ---------- */
  const hero = el('section.hero', {}, [
    el('div.container', {}, [
      el('div.hero-badge', {}, [
        el('span.dot'),
        `Node.js ${processSafe()} · SQLite · 零第三方依赖`,
      ]),
      el('h1', {}, [
        '一个 ',
        el('em.text-gradient', {}, '全栈综合站点'),
        '，八套系统一个进程',
      ]),
      el('p.hero-sub', {}, store.settings.site_description || store.settings.site_tagline || '博客、笔记、待办、书签、短链、图床、聊天室与数据看板，前后端都由原生 JavaScript 驱动。'),
      el('div.hero-actions', {}, [
        el('a.btn.btn-primary.btn-lg', { href: store.user ? '#/dashboard' : '#/register' }, store.user ? '进入工作台' : '免费开始使用'),
        el('a.btn.btn-ghost.btn-lg', { href: '#/blog' }, '浏览文章'),
        el('a.btn.btn-ghost.btn-lg', { href: '#/chat' }, '进入聊天室'),
      ]),
      stats &&
        el('div.hero-stats', {}, [
          heroStat(stats.posts, '已发布文章'),
          heroStat(stats.views, '总阅读量'),
          heroStat(stats.users, '注册用户'),
          heroStat(stats.comments, '条评论'),
          heroStat(stats.notes + stats.todos, '条记录'),
        ]),
    ]),
  ]);

  /* ---------- 精选文章 ---------- */
  const featuredSection = el('section.section.container', {}, [
    el('div.section-head', {}, [
      el('h2', {}, '精选文章'),
      el('a.link-more', { href: '#/blog' }, '查看全部 →'),
    ]),
  ]);

  if (featured.items?.length) {
    const grid = el('div.grid.grid-3');
    for (const post of featured.items.slice(0, 3)) {
      grid.append(
        el('a.post-card', { href: `#/blog/${post.slug}` }, [
          post.cover
            ? el('img', { src: post.cover, alt: '', style: { borderRadius: '10px', aspectRatio: '16/9', objectFit: 'cover' } })
            : null,
          el('div.meta', {}, [
            post.category ? badge(post.category.name, 'brand') : null,
            el('span', {}, timeAgo(post.publishedAt || post.createdAt)),
          ]),
          el('h3', {}, el('span.clamp-2', {}, post.title)),
          el('p.clamp-2', {}, post.excerpt || '（无摘要）'),
          el('div.row', { style: { marginTop: 'auto' } }, [
            avatar(post.author, 'sm'),
            el('span.small.muted', {}, post.author.nickname || post.author.username),
            el('span.grow'),
            el('span.small.muted', {}, `👁 ${numberFmt(post.views)}`),
          ]),
        ]),
      );
    }
    featuredSection.append(grid);
  } else {
    featuredSection.append(empty('还没有精选文章', '登录后发布第一篇文章吧', el('a.btn.btn-primary', { href: '#/blog/new' }, '去写作')));
  }

  /* ---------- 模块网格 ---------- */
  const modules = el('section.section.container', {}, [
    el('div.section-head', {}, el('h2', {}, `${name} 有什么`)),
    el(
      'div.feature-grid',
      {},
      MODULES.map((m) =>
        el('a.feature-card', { href: m.href }, [
          el('div.feature-icon', {}, m.icon),
          el('h3', {}, m.title),
          el('p', {}, m.desc),
        ]),
      ),
    ),
  ]);

  /* ---------- 数据面板 ---------- */
  let statsSection = null;
  if (stats) {
    statsSection = el('section.section.container', {}, [
      el('div.section-head', {}, [
        el('h2', {}, '站点数据'),
        el('a.link-more', { href: '#/dashboard' }, '详细看板 →'),
      ]),
      el('div.grid.grid-sidebar', {}, [
        el('div.card', {}, [
          el('div.card-title', {}, '近 14 天活跃趋势'),
          lineChart(stats.trend || [], { height: 240 }),
        ]),
        el('div.col', {}, [
          miniStat('📄', '文章', stats.posts, stats.drafts ? `+${stats.drafts} 草稿` : ''),
          miniStat('👥', '用户', stats.users, ''),
          miniStat('💬', '评论', stats.comments, stats.pendingComments ? `${stats.pendingComments} 待审` : ''),
          miniStat('🔗', '短链点击', stats.shortClicks, `${stats.shortLinks} 条短链`),
          miniStat('💾', '文件存储', `${(stats.storage / 1024 / 1024).toFixed(1)}MB`, `${stats.files} 个文件`),
        ]),
      ]),
      stats.tags?.length
        ? el('div.row.wrap', { style: { marginTop: '16px' } }, [
            el('span.small.muted', {}, '热门标签：'),
            ...stats.tags.slice(0, 10).map((t) => el('a.chip', { href: `#/blog?tag=${t.slug}` }, `${t.name} ${t.c}`)),
          ])
        : null,
    ]);
  }

  /* ---------- 技术栈 ---------- */
  const stack = el('section.section.container', {}, [
    el('div.card.card-flat', {}, [
      el('div.card-title', {}, '技术实现'),
      el('div.grid.grid-4', { style: { gap: '10px' } }, [
        stackItem('node:http', '原生 HTTP 服务，无 Express'),
        stackItem('node:sqlite', '单文件数据库，WAL 模式'),
        stackItem('WebSocket', '手写 RFC 6455 帧解析'),
        stackItem('ES Module', '前端零构建，改完即生效'),
        stackItem('scrypt', '密码哈希 + HS256 会话'),
        stackItem('Canvas', '自绘折线/柱状/环形图'),
        stackItem('FormData', '手写 multipart 解析器'),
        stackItem('CSS 变量', '亮暗双主题设计系统'),
      ]),
    ]),
  ]);

  /* ---------- CTA ---------- */
  const cta = el('section.section.container', {}, [
    el('div.card', { style: { textAlign: 'center', padding: '48px 24px', background: 'linear-gradient(135deg, var(--brand-soft), var(--surface))' } }, [
      el('h2', {}, store.user ? '继续探索你的工作台' : '现在就开始使用'),
      el('p.soft', { style: { margin: '10px auto 22px', maxWidth: '46ch' } },
        store.user ? '查看内容数据、管理笔记待办、上传文件、生成短链。' : '注册账号即可获得笔记、待办、书签、文件与短链的全部功能。'),
      el('a.btn.btn-primary.btn-lg', { href: store.user ? '#/dashboard' : '#/register' }, store.user ? '打开工作台' : '免费注册'),
    ]),
  ]);

  host.append(hero, featuredSection, modules, statsSection, stack, cta);
}

function heroStat(value, label) {
  return el('div.hero-stat', {}, [el('div.v', {}, numberFmt(value || 0)), el('div.k', {}, label)]);
}

function miniStat(icon, label, value, hint) {
  return el('div.card.pad-sm', {}, [
    el('div.row', {}, [
      el('span', {}, icon),
      el('span.small.muted', {}, label),
      el('span.grow'),
      el('strong', {}, typeof value === 'number' ? numberFmt(value) : value),
    ]),
    hint ? el('div.small.muted', { style: { marginTop: '4px' } }, hint) : null,
  ]);
}

function stackItem(name, desc) {
  return el('div', { style: { padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '10px' } }, [
    el('div.mono.small', { style: { fontWeight: '700', color: 'var(--brand-text)' } }, name),
    el('div.small.muted', {}, desc),
  ]);
}

function processSafe() {
  return typeof process !== 'undefined' ? process.versions?.node : 'LTS';
}
