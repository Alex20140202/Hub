import { el, debounce } from '../lib/dom.js';
import { PublicAPI, PostAPI } from '../lib/api.js';
import { highlight, timeAgo, dateShort } from '../lib/format.js';
import { avatar, badge, empty, skeleton, segmented } from '../ui/components.js';
import { go } from '../lib/router.js';

const GROUPS = [
  { key: 'posts', label: '文章', icon: '📄' },
  { key: 'notes', label: '笔记', icon: '📓' },
  { key: 'links', label: '书签', icon: '🔖' },
  { key: 'todos', label: '待办', icon: '✅' },
  { key: 'users', label: '用户', icon: '👤' },
  { key: 'tags', label: '标签', icon: '🏷' },
];

export default async function searchView(host, ctx) {
  const q = ctx.query.q || '';
  const input = el('input.input', { type: 'search', value: q, 'aria-label': '搜索关键词', placeholder: '搜索文章、笔记、书签、用户…', style: { fontSize: '1.1rem', padding: '14px 18px' } });
  const resultBox = el('div');
  const filterBox = el('div.row.wrap', { style: { gap: '6px' } });
  let filter = 'all';
  let last = null;
  let lastKeyword = q;

  host.append(
    el('div.container', { style: { maxWidth: '860px' } }, [
      el('div.page-head', {}, [el('h1', {}, '搜索'), el('p', {}, '⌘K 随时唤起，模糊匹配标题与正文')]),
      el('div.card', { style: { padding: '0' } }, input),
      el('div', { style: { margin: '18px 0' } }, filterBox),
      resultBox,
    ]),
  );

  renderFilters();

  function renderFilters() {
    clear();
    const all = el(`button.chip${filter === 'all' ? '.active' : ''}`, { type: 'button' }, '全部');
    all.addEventListener('click', () => {
      filter = 'all';
      renderFilters();
      if (last) render(last, lastKeyword);
    });
    filterBox.append(all);
    for (const g of GROUPS) {
      const btn = el(`button.chip${filter === g.key ? '.active' : ''}`, { type: 'button' }, `${g.icon} ${g.label}`);
      btn.addEventListener('click', () => {
        filter = g.key;
        renderFilters();
        if (last) render(last, lastKeyword);
      });
      filterBox.append(btn);
    }
  }
  function clear() {
    filterBox.replaceChildren();
  }

  const doSearch = debounce(async (keyword) => {
    if (!keyword) {
      resultBox.replaceChildren(el('div.empty', {}, [el('p.muted', {}, '输入关键词开始搜索')]));
      return;
    }
    resultBox.replaceChildren(skeleton(3));
    try {
      const data = await PublicAPI.search(keyword);
      last = data;
      lastKeyword = keyword;
      render(data, keyword);
    } catch (err) {
      resultBox.replaceChildren(el('div.alert.alert-danger', {}, err.message));
    }
  }, 280);

  function render(data, keyword) {
    resultBox.replaceChildren();
    if (!data.total) {
      resultBox.append(empty(`没有找到「${keyword}」`, '换个关键词或检查拼写', null, '🔍'));
      return;
    }
    resultBox.append(el('p.small.muted', { style: { marginBottom: '14px' } }, `共找到 ${data.total} 条与「${keyword}」相关的结果`));

    for (const group of GROUPS) {
      const items = data.groups[group.key];
      if (!items?.length) continue;
      if (filter !== 'all' && filter !== group.key) continue;

      const section = el('section', { style: { marginBottom: '24px' } }, [
        el('div.section-head', { style: { marginBottom: '10px' } }, [
          el('h2', { style: { fontSize: '1.05rem' } }, `${group.icon} ${group.label}`),
          el('span.badge', {}, String(items.length)),
        ]),
      ]);
      const list = el('div.col', { style: { gap: '8px' } });

      for (const item of items) {
        if (group.key === 'posts') {
          list.append(
            el('a.card.pad-sm.hover', { href: `#/blog/${item.slug}`, style: { display: 'block', color: 'inherit' } }, [
              el('div.row', { style: { gap: '8px' } }, [
                el('strong.grow.truncate', { html: highlight(item.title, keyword) }),
                el('span.small.muted.nowrap', {}, `👁 ${item.views}`),
              ]),
              el('p.small.muted.clamp-2', { style: { marginTop: '4px' }, html: highlight(item.excerpt || '', keyword) }),
              el('div.small.muted', { style: { marginTop: '6px' } }, `${item.nickname || item.username} · ${timeAgo(item.published_at)}`),
            ]),
          );
        } else if (group.key === 'notes') {
          list.append(
            el('a.card.pad-sm.hover', { href: '#/notes', style: { display: 'block', color: 'inherit' } }, [
              el('strong.grow.truncate', { html: highlight(item.title, keyword) }),
              el('p.small.muted.clamp-2', { html: highlight(item.snippet || '', keyword) }),
            ]),
          );
        } else if (group.key === 'links') {
          list.append(
            el('a.card.pad-sm.hover', { href: '#/links', style: { display: 'block', color: 'inherit' } }, [
              el('strong.grow.truncate', { html: highlight(item.title, keyword) }),
              el('div.small.muted.truncate', { html: highlight(item.url, keyword) }),
            ]),
          );
        } else if (group.key === 'todos') {
          list.append(
            el('a.card.pad-sm.hover', { href: '#/todos', style: { display: 'block', color: 'inherit' } }, [
              el('div.row', {}, [
                el('span', {}, item.done ? '✅' : '⬜'),
                el('strong.grow', { html: highlight(item.title, keyword) }),
              ]),
            ]),
          );
        } else if (group.key === 'users') {
          list.append(
            el('a.card.pad-sm.hover', { href: `#/u/${item.username}`, style: { display: 'block', color: 'inherit' } }, [
              el('div.row', {}, [
                avatar(item, 'sm'),
                el('div.grow', {}, [
                  el('strong', { html: highlight(item.nickname || item.username, keyword) }),
                  el('div.small.muted', {}, `@${item.username}`),
                ]),
              ]),
            ]),
          );
        } else if (group.key === 'tags') {
          list.append(
            el('a.card.pad-sm.hover', { href: `#/blog?tag=${item.slug}`, style: { display: 'block', color: 'inherit' } }, [
              el('strong', { html: highlight(item.name, keyword) }),
            ]),
          );
        }
      }

      section.append(list);
      resultBox.append(section);
    }
  }

  input.addEventListener('input', () => {
    const value = input.value.trim();
    history.replaceState(null, '', `#/search?q=${encodeURIComponent(value)}`);
    doSearch(value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch(input.value.trim());
  });

  doSearch(q);
  setTimeout(() => input.focus(), 60);
}
