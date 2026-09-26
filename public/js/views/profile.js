import { el, clear } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { AuthAPI, StatsAPI, PostAPI } from '../lib/api.js';
import { numberFmt, dateShort, timeAgo, humanSize } from '../lib/format.js';
import { avatar, badge, empty, skeleton, statCard, ring, progress } from '../ui/components.js';
import { barChart, lineChart, donutChart, chartLegend, heatmap } from '../ui/chart.js';
import { toast } from '../ui/toast.js';
import { go } from '../lib/router.js';
import { confirmDialog } from '../ui/modal.js';

export default async function profileView(host) {
  host.replaceChildren(skeleton(3));
  const user = store.user;
  const [dashboard, leaderboard, settings] = await Promise.all([
    StatsAPI.dashboard(),
    StatsAPI.leaderboard().catch(() => ({ items: [] })),
    AuthAPI.sessions().catch(() => ({ items: [] })),
  ]);

  const { mine, global } = dashboard;

  host.replaceChildren(
    /* 头部 */
    el('section.hero', { style: { padding: '40px 0 28px' } }, [
      el('div.container', {}, [
        el('div.row.wrap', { style: { gap: '20px' } }, [
          avatar(user, 'xl'),
          el('div.grow', { style: { minWidth: '220px' } }, [
            el('h1', { style: { fontSize: 'var(--step-2)' } }, user.nickname || user.username),
            el('p.soft', {}, user.bio || '还没有填写个人简介'),
            el('div.row.wrap.small.muted', { style: { marginTop: '8px', gap: '12px' } }, [
              el('span', {}, `@${user.username}`),
              el('span', {}, `加入于 ${dateShort(user.created_at)}`),
              user.last_login ? el('span', {}, `最近登录 ${timeAgo(user.last_login)}`) : null,
              badge(user.role === 'admin' ? '管理员' : user.role === 'moderator' ? '版主' : '成员', user.role === 'admin' ? 'brand' : ''),
            ]),
          ]),
          el('div.row', {}, [
            el('a.btn.btn-ghost', { href: '#/settings' }, '⚙️ 资料设置'),
            el('a.btn.btn-primary', { href: '#/blog/new' }, '✍️ 写文章'),
          ]),
        ]),
      ]),
    ]),

    el('div.container', {}, [
      /* 我的数据 */
      el('section', {}, el('div.stat-grid', {}, [
        statCard({ label: '文章', value: mine.posts, icon: '📄', hint: `${mine.drafts} 篇草稿` }),
        statCard({ label: '阅读量', value: mine.views, icon: '👁', hint: `平均 ${mine.posts ? Math.round(mine.views / mine.posts) : 0}/篇` }),
        statCard({ label: '点赞', value: mine.likes, icon: '❤️', hint: '收到的赞' }),
        statCard({ label: '评论', value: mine.comments, icon: '💬', hint: '发出的评论' }),
        statCard({ label: '待办', value: mine.todos, icon: '✅', hint: `完成 ${mine.done}` }),
      ])),

      el('div.grid.grid-sidebar', { style: { marginTop: '24px' } }, [
        el('div.col', { style: { gap: '20px' } }, [
          /* 趋势 */
          el('div.card', {}, [
            el('div.card-title', {}, '📈 站点活跃趋势'),
            lineChart(dashboard.trend, { height: 220 }),
          ]),

          /* 作品 */
          el('div.card', {}, [
            el('div.row-between', { style: { marginBottom: '12px' } }, [
              el('div.card-title', { style: { margin: '0' } }, '🕐 最近动态'),
            ]),
            dashboard.topPosts.length
              ? el('div.list', {}, dashboard.topPosts.map((p) =>
                  el('div.list-item', {}, [
                    el('a.grow.truncate', { href: `#/blog/${p.slug}`, style: { color: 'var(--text)' } }, p.title),
                    el('span.small.muted.nowrap', {}, `👁 ${numberFmt(p.views)} · ♥ ${p.likes}`),
                  ]),
                ))
              : el('p.muted.small', {}, '发布文章后这里会显示数据'),
          ]),

          /* 排行榜 */
          el('div.card', {}, [
            el('div.card-title', {}, '🏆 活跃榜'),
            el('div.list', {}, leaderboard.items.map((u, i) =>
              el('div.list-item', {}, [
                el('span.badge', { style: i < 3 ? 'background: linear-gradient(135deg,#fbbf24,#f59e0b); color:#fff; border:none' : '' }, String(i + 1)),
                avatar(u, 'sm'),
                el('a.grow.truncate', { href: `#/u/${u.username}`, style: { color: 'var(--text)' } }, u.nickname || u.username),
                el('span.small.muted', {}, `${numberFmt(u.views)} 阅读`),
              ]),
            )),
          ]),
        ]),

        /* 侧栏 */
        el('div.col', { style: { gap: '16px' } }, [
          el('div.card', {}, [
            el('div.card-title', {}, '📦 数据导出'),
            el('p.small.muted', { style: { marginBottom: '10px' } }, '导出你的笔记、待办、书签与短链数据为 JSON'),
            el('button.btn.btn-ghost.btn-block.btn-sm', { type: 'button', onclick: doExport }, '下载我的数据'),
          ]),
          el('div.card', {}, [
            el('div.card-title', {}, '🔐 登录设备'),
            el('div.list', {}, settings.items.slice(0, 5).map((s) =>
              el('div.list-item', {}, [
                el('div.grow', { style: { minWidth: '0' } }, [
                  el('div.small.truncate', {}, (s.user_agent || '未知设备').slice(0, 46)),
                  el('div.small.muted', {}, `${s.ip || '-'} · ${timeAgo(s.created_at)}`),
                ]),
              ]),
            )),
          ]),
          el('div.card', {}, [
            el('div.card-title', {}, '🌐 站点概览'),
            el('div.list', {}, [
              row('文章总数', global.posts),
              row('用户数', global.users),
              row('评论数', global.comments),
              row('文件数', global.files),
              row('短链点击', global.shortClicks),
            ]),
          ]),
        ]),
      ]),
    ]),
  );

  function row(k, v) {
    return el('div.row-between', { style: { fontSize: '0.88rem' } }, [
      el('span.muted', {}, k),
      el('strong', {}, numberFmt(v)),
    ]);
  }

  async function doExport() {
    try {
      const data = await AuthAPI.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `hub-export-${Date.now()}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('数据已导出');
    } catch (err) {
      toast.error(err.message);
    }
  }
}
