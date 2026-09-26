import { el } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { StatsAPI, PostAPI, NoteAPI, TodoAPI, LinkAPI, FileAPI } from '../lib/api.js';
import { numberFmt, dateShort, timeAgo, humanSize } from '../lib/format.js';
import { statCard, empty, skeleton, progress, ring, badge, avatar } from '../ui/components.js';
import { lineChart, barChart, donutChart, heatmap, chartLegend } from '../ui/chart.js';
import { go } from '../lib/router.js';

export default async function dashboardView(host) {
  host.replaceChildren(skeleton(4, { title: true }));

  const [data, todos, notes, links, files] = await Promise.all([
    StatsAPI.dashboard(),
    TodoAPI.list().catch(() => ({ items: [], stats: {} })),
    NoteAPI.list().catch(() => ({ items: [] })),
    LinkAPI.list().catch(() => ({ items: [] })),
    FileAPI.list({ size: 100 }).catch(() => ({ items: [], usage: { byFolder: [], total: 0 } })),
  ]);

  const { mine, global, trend, topPosts, recentComments } = data;
  const user = store.user;

  host.replaceChildren(
    el('div.page-head', {}, [
      el('div.row-between.wrap', {}, [
        el('div', {}, [
          el('h1', {}, `${greeting()}，${user.nickname || user.username}`),
          el('p', {}, `今天是 ${dateShort(Date.now())} · 加入于 ${dateShort(user.created_at)}`),
        ]),
        el('div.row', {}, [
          el('a.btn.btn-ghost', { href: '#/blog?mine=1' }, '我的文章'),
          el('a.btn.btn-primary', { href: '#/blog/new' }, '✍️ 写文章'),
        ]),
      ]),
    ]),

    /* 我的数据 */
    el('section', {}, [
      el('div.stat-grid', {}, [
        statCard({ label: '已发布', value: mine.posts, icon: '📄', hint: mine.drafts ? `${mine.drafts} 篇草稿` : '暂无草稿' }),
        statCard({ label: '总阅读', value: mine.views, icon: '👁', hint: '所有文章累计' }),
        statCard({ label: '获得点赞', value: mine.likes, icon: '❤️', hint: `${recentComments.length} 条新评论` }),
        statCard({ label: '待办完成', value: `${todos.stats.done || 0}/${todos.stats.total || 0}`, icon: '✅', hint: `完成率 ${todos.stats.rate || 0}%` }),
        statCard({ label: '我的笔记', value: notes.items.length, icon: '📓', hint: `${links.items.length} 个书签` }),
        statCard({ label: '文件存储', value: humanSize(files.usage.total), icon: '📁', hint: `${files.items.length} 个文件` }),
      ]),
    ]),

    el('div.grid.grid-sidebar', { style: { marginTop: '24px' } }, [
      /* 趋势 */
      el('div.col', { style: { gap: '20px' } }, [
        el('div.card', {}, [
          el('div.card-title', {}, '📈 近 14 天站点活跃'),
          lineChart(trend, { height: 240 }),
          el('div.small.muted', { style: { marginTop: '8px' } }, '统计口径：页面访问、文章阅读、评论与内容创建等行为事件'),
        ]),

        el('div.grid.grid-2', {}, [
          el('div.card', {}, [
            el('div.card-title', {}, '🔥 我的热门文章'),
            topPosts.length
              ? el('div.list', {}, topPosts.map((p, i) =>
                  el('div.list-item', {}, [
                    el('span.badge.badge-brand', {}, String(i + 1)),
                    el('a.grow.truncate', { href: `#/blog/${p.slug}`, style: { color: 'var(--text)' } }, p.title),
                    el('span.small.muted.nowrap', {}, `👁 ${numberFmt(p.views)}`),
                  ]),
                ))
              : el('p.muted.small', {}, '发布文章后这里会显示排行'),
          ]),
          el('div.card', {}, [
            el('div.card-title', {}, '💬 我的评论'),
            recentComments.length
              ? el('div.list', {}, recentComments.map((c) =>
                  el('div.list-item', {}, [
                    el('div.grow', { style: { minWidth: '0' } }, [
                      el('div.small.truncate', {}, c.body),
                      el('a.small.muted.truncate', { href: `#/blog/${c.slug}` }, `→ ${c.title}`),
                    ]),
                    el('span.small.muted.nowrap', {}, timeAgo(c.created_at)),
                  ]),
                ))
              : el('p.muted.small', {}, '还没有评论过文章'),
          ]),
        ]),

        el('div.card', {}, [
          el('div.card-title', {}, '⏱️ 近 90 天活跃热力图'),
          heatmap(await StatsAPI.heatmap().then((r) => r.items).catch(() => [])),
          el('div.small.muted', { style: { marginTop: '8px' } }, '颜色越亮表示当天事件越多'),
        ]),
      ]),

      /* 侧边栏 */
      el('div.col', { style: { gap: '16px' } }, [
        el('div.card', {}, [
          el('div.card-title', {}, '🎯 待办进度'),
          el('div.row', { style: { gap: '16px' } }, [
            ring(todos.stats.rate || 0, { size: 88 }),
            el('div.col', { style: { gap: '2px', fontSize: '0.85rem' } }, [
              el('div', {}, ['进行中 ', el('strong', {}, String(todos.stats.open || 0))]),
              el('div.muted', {}, ['已完成 ', el('strong', {}, String(todos.stats.done || 0))]),
              todos.stats.overdue ? el('div', { style: { color: 'var(--danger)' } }, `逾期 ${todos.stats.overdue}`) : null,
            ]),
          ]),
          el('a.btn.btn-ghost.btn-sm.btn-block', { href: '#/todos', style: { marginTop: '12px' } }, '管理待办'),
        ]),

        el('div.card', {}, [
          el('div.card-title', {}, '🗂 存储分布'),
          files.usage.byFolder.length
            ? donutChart(
                files.usage.byFolder.map((f) => ({ label: folderLabel(f.folder), value: f.bytes || 0 })),
                { size: 160, centerLabel: humanSize(files.usage.total) },
              )
            : el('p.muted.small', {}, '还没有上传文件'),
          el('div', { style: { marginTop: '12px' } },
            files.usage.byFolder.length
              ? chartLegend(files.usage.byFolder.map((f) => ({ label: folderLabel(f.folder), value: humanSize(f.bytes || 0), color: undefined })))
              : null),
          el('a.btn.btn-ghost.btn-sm.btn-block', { href: '#/files', style: { marginTop: '12px' } }, '管理文件'),
        ]),

        el('div.card', {}, [
          el('div.card-title', {}, '🌐 站点概况'),
          el('div.list', {}, [
            kv('文章', `${global.posts} 篇`),
            kv('用户', `${global.users} 人`),
            kv('评论', `${global.comments} 条`),
            kv('短链', `${global.shortLinks} 条 / ${numberFmt(global.shortClicks)} 次点击`),
            kv('消息', `${global.messages} 条`),
            kv('订阅', `${global.subscribers} 人`),
          ]),
        ]),

        store.user.role === 'admin'
          ? el('a.card.hover', { href: '#/admin', style: { display: 'block' } }, [
              el('div.card-title', {}, '🛡 管理后台'),
              el('p.small.muted', {}, '用户管理、评论审核、站点设置与数据维护'),
            ])
          : null,
      ]),
    ]),

    /* 快捷入口 */
    el('section.section', {}, [
      el('div.section-head', {}, el('h2', {}, '快捷操作')),
      el('div.grid.grid-4', {}, [
        quickCard('📝', '写文章', '记录此刻的想法', '#/blog/new'),
        quickCard('📓', '新笔记', '快速记一条备忘', '#/notes?new=1'),
        quickCard('✅', '加待办', '别再忘记要做的事', '#/todos?new=1'),
        quickCard('🔗', '生成短链', '分享更短的链接', '#/short'),
      ]),
    ]),
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function kv(k, v) {
  return el('div.row-between', { style: { fontSize: '0.88rem' } }, [
    el('span.muted', {}, k),
    el('strong', {}, v),
  ]);
}

function quickCard(icon, title, desc, href) {
  return el('a.card.hover', { href }, [
    el('div.row', {}, [el('span', { style: { fontSize: '1.4rem' } }, icon), el('strong', {}, title)]),
    el('p.small.muted', { style: { marginTop: '4px' } }, desc),
  ]);
}

function folderLabel(folder) {
  return { image: '图片', doc: '文档', archive: '压缩包', media: '媒体', misc: '其他' }[folder] || folder;
}
