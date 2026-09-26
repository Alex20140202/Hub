import { el } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { PublicAPI } from '../lib/api.js';
import { numberFmt, dateShort, timeAgo } from '../lib/format.js';
import { avatar, avatarFramed, badge, empty, skeleton, statCard } from '../ui/components.js';
import { postCard } from './blog.js';

export default async function userView(host, ctx) {
  host.replaceChildren(skeleton(2));
  let data;
  try {
    data = await PublicAPI.user(ctx.params.username);
  } catch (err) {
    host.replaceChildren(empty('用户不存在', err.message, el('a.btn.btn-primary', { href: '/' }, '返回首页'), '👤'));
    return;
  }

  const { user, posts, stats, isMe } = data;
  document.title = `${user.nickname || user.username} · ${store.settings.site_name}`;

  host.replaceChildren(
    el('section.hero', { style: { padding: '48px 0 32px' } }, [
      el('div.container', {}, [
        el('div.row.wrap', { style: { gap: '20px' } }, [
          avatarFramed(user, 'xl'),
          el('div.grow', { style: { minWidth: '200px' } }, [
            el('div.row', { style: { gap: '8px' } }, [
              el('h1', { style: { fontSize: 'var(--step-3)' } }, user.nickname || user.username),
              badge(user.role === 'admin' ? '站主' : user.role === 'moderator' ? '版主' : '成员', user.role === 'admin' ? 'brand' : ''),
              isMe ? badge('这是你', 'success') : null,
            ]),
            el('p.soft', { style: { marginTop: '6px' } }, user.bio || '这个人很懒，什么都没写。'),
            el('div.row.wrap.small.muted', { style: { marginTop: '10px', gap: '14px' } }, [
              el('span', {}, `@${user.username}`),
              el('span', {}, `📅 ${dateShort(user.created_at)} 加入`),
              user.location ? el('span', {}, `📍 ${user.location}`) : null,
              user.website ? el('a', { href: user.website, target: '_blank', rel: 'noopener' }, `🔗 ${user.website.replace(/^https?:\/\//, '')}`) : null,
            ]),
          ]),
          isMe
            ? el('div.row', {}, [
                el('a.btn.btn-ghost', { href: '#/settings' }, '编辑资料'),
                el('a.btn.btn-primary', { href: '#/blog/new' }, '写文章'),
              ])
            : el('a.btn.btn-ghost', { href: `#/search?q=${encodeURIComponent(user.username)}` }, '搜索 TA 的内容'),
        ]),
        el('div.hero-stats', {}, [
          el('div.hero-stat', {}, [el('div.v', {}, numberFmt(stats.posts)), el('div.k', {}, '文章')]),
          el('div.hero-stat', {}, [el('div.v', {}, numberFmt(stats.views)), el('div.k', {}, '阅读量')]),
          el('div.hero-stat', {}, [el('div.v', {}, numberFmt(stats.likes)), el('div.k', {}, '获赞')]),
          el('div.hero-stat', {}, [el('div.v', {}, numberFmt(stats.comments)), el('div.k', {}, '评论')]),
        ]),
      ]),
    ]),

    el('section.section.container', {}, [
      el('div.section-head', {}, el('h2', {}, `TA 的文章（${posts.length}）`)),
      posts.length
        ? el('div.grid.grid-3', {}, posts.map((p) => postCard(p)))
        : empty('还没有发布文章', isMe ? '去写第一篇吧' : '关注 TA 获取更新', isMe ? el('a.btn.btn-primary', { href: '#/blog/new' }, '写文章') : null, '📄'),
    ]),
  );
}
