import { el } from '../lib/dom.js';
import { store } from '../lib/store.js';

const LINKS = store.user
  ? [
      ['#/dashboard', '工作台', '📊'],
      ['#/blog', '博客', '📄'],
      ['#/notes', '笔记', '📓'],
      ['#/chat', '聊天室', '💬'],
    ]
  : [
      ['#/', '首页', '🏠'],
      ['#/blog', '博客', '📄'],
      ['#/search', '搜索', '🔍'],
      ['#/login', '登录', '🔐'],
    ];

export default function notFoundView(host, ctx) {
  const keyword = decodeURIComponent(ctx?.query?.q || ctx?.params?.path || '');

  host.append(
    el('div.container', { style: { maxWidth: '720px', padding: '64px 0 96px', textAlign: 'center' } }, [
      el('div', { style: { fontSize: 'clamp(72px, 18vw, 148px)', fontWeight: '800', lineHeight: '1', letterSpacing: '-0.04em', background: 'linear-gradient(135deg, var(--brand), var(--accent))', '-webkit-background-clip': 'text', backgroundClip: 'text', color: 'transparent' } }, '404'),
      el('h1', { style: { marginTop: '16px' } }, keyword ? `没有找到「${keyword}」` : '这个页面走丢了'),
      el('p.soft', { style: { marginTop: '8px' } }, '链接可能已失效、被移动，或者从来就不存在。'),

      el('div.row.wrap', { style: { justifyContent: 'center', marginTop: '24px', gap: '10px' } }, [
        el('button.btn.btn-primary', { type: 'button', onclick: () => history.back() }, '← 返回上一页'),
        el('a.btn.btn-ghost', { href: '#/' }, '回到首页'),
      ]),

      el('div.card', { style: { marginTop: '48px', textAlign: 'left' } }, [
        el('div.card-title', {}, '🧭 你可以试试这些'),
        el('div.grid.grid-2', { style: { gap: '10px', marginTop: '10px' } },
          LINKS.map(([href, label, icon]) =>
            el('a.card.pad-sm.hover', { href, style: { display: 'block', color: 'inherit' } }, [
              el('div.row', { style: { gap: '8px' } }, [el('span', {}, icon), el('strong', {}, label)]),
            ]),
          ),
        ),
      ]),

      el('p.small.muted', { style: { marginTop: '28px' } }, [
        '如果你是通过站内链接到达这里的，可以按 ',
        el('kbd', {}, '/'),
        ' 打开搜索，或 ',
        el('kbd', {}, '⌘K'),
        ' 使用命令面板。',
      ]),
    ]),
  );
}
