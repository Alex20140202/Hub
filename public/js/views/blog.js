import { el, clear, debounce } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { PostAPI } from '../lib/api.js';
import { go, refresh } from '../lib/router.js';
import { numberFmt, timeAgo, highlight } from '../lib/format.js';
import { avatar, badge, empty, pager, skeleton, segmented } from '../ui/components.js';

const SORTS = [
  { value: 'new', label: '最新' },
  { value: 'hot', label: '最热' },
  { value: 'likes', label: '最赞' },
  { value: 'comments', label: '评论最多' },
];

export default async function blogView(host, ctx) {
  const state = {
    page: Number(ctx.query.page) || 1,
    q: ctx.query.q || '',
    tag: ctx.query.tag || '',
    category: ctx.query.category || '',
    sort: ctx.query.sort || 'new',
    mine: ctx.query.mine === '1',
    bookmarked: ctx.query.bookmarked === '1',
  };

  const head = el('div.page-head', {}, [
    el('div.row-between.wrap', {}, [
      el('div', {}, [
        el('h1', {}, state.mine ? '我的文章' : state.bookmarked ? '我的收藏' : '博客'),
        el('p', {}, state.mine ? '管理你发布的全部内容' : '技术分享、产品思考与生活随笔'),
      ]),
      el('div.row', {}, [
        el('div#sort-slot'),
        el('a.btn.btn-primary', { href: '#/blog/new' }, '✍️ 写文章'),
      ]),
    ]),
  ]);

  const filters = el('div.card.pad-sm', { style: { marginBottom: '20px' } });
  const listNode = el('div');
  const pagerNode = el('div');
  const cats = await PostAPI.categories().catch(() => ({ items: [] }));
  const tags = await PostAPI.tags().catch(() => ({ items: [] }));

  /* 搜索框 */
  const search = el('div.input-group', { style: { marginBottom: '12px' } }, [
    el('input.input', {
      type: 'search',
      placeholder: '搜索标题或正文…',
      value: state.q,
      'aria-label': '搜索文章',
    }),
  ]);
  const searchInput = search.querySelector('input');
  searchInput.addEventListener(
    'input',
    debounce(() => {
      state.q = searchInput.value.trim();
      state.page = 1;
      syncUrl();
      load();
    }, 320),
  );

  /* 分类 / 标签 */
  const catRow = el('div.row.wrap', { style: { gap: '6px', marginTop: '10px' } }, [
    chip('全部分类', !state.category, () => {
      state.category = '';
      state.page = 1;
      syncUrl();
      load();
    }),
    ...cats.items.map((c) =>
      chip(`${c.name} ${c.count}`, state.category === c.slug, () => {
        state.category = c.slug;
        state.page = 1;
        syncUrl();
        load();
      }),
    ),
  ]);

  const tagRow = tags.items.length
    ? el('div.row.wrap', { style: { gap: '6px', marginTop: '8px' } }, [
        el('span.small.muted', {}, '标签：'),
        ...tags.items.slice(0, 14).map((t) =>
          chip(t.name, state.tag === t.slug, () => {
            state.tag = state.tag === t.slug ? '' : t.slug;
            state.page = 1;
            syncUrl();
            load();
          }),
        ),
      ])
    : null;

  filters.append(search, catRow, tagRow);

  /* 排序 */
  const sortSlot = head.querySelector('#sort-slot');
  sortSlot.append(
    segmented(SORTS, state.sort, (value) => {
      state.sort = value;
      state.page = 1;
      syncUrl();
      load();
    }),
  );

  host.append(head, filters, listNode, pagerNode);

  function syncUrl() {
    const params = new URLSearchParams();
    if (state.page > 1) params.set('page', state.page);
    if (state.q) params.set('q', state.q);
    if (state.tag) params.set('tag', state.tag);
    if (state.category) params.set('category', state.category);
    if (state.sort !== 'new') params.set('sort', state.sort);
    if (state.mine) params.set('mine', '1');
    if (state.bookmarked) params.set('bookmarked', '1');
    const qs = params.toString();
    history.replaceState(null, '', `#/blog${qs ? `?${qs}` : ''}`);
  }

  async function load() {
    listNode.replaceChildren(skeleton(3));
    pagerNode.replaceChildren();
    try {
      const data = await PostAPI.list({
        page: state.page,
        size: 8,
        q: state.q,
        tag: state.tag,
        category: state.category,
        sort: state.sort,
        status: state.mine ? 'all' : 'published',
        author: state.mine ? store.user?.id : undefined,
        bookmarked: state.bookmarked ? 'true' : undefined,
      });
      listNode.replaceChildren();
      if (!data.items.length) {
        listNode.append(
          empty(
            state.q || state.tag || state.category ? '没有匹配的文章' : '还没有文章',
            state.q || state.tag || state.category ? '换个关键词或清除筛选试试' : '成为第一个分享的人',
            el('a.btn.btn-primary', { href: '#/blog/new' }, '写第一篇'),
            '📭',
          ),
        );
        return;
      }
      const grid = el('div.grid.grid-2');
      for (const post of data.items) grid.append(postCard(post, state.q));
      listNode.append(grid);
      const p = pager({ page: data.page, pages: data.pages, onChange: (n) => {
        state.page = n;
        syncUrl();
        load();
        window.scrollTo({ top: host.offsetTop - 80, behavior: 'smooth' });
      } });
      if (p) pagerNode.append(p);
    } catch (err) {
      listNode.replaceChildren(el('div.alert.alert-danger', {}, err.message));
    }
  }

  load();
}

function chip(label, active, onClick) {
  const node = el(`button.chip${active ? '.active' : ''}`, { type: 'button' }, label);
  node.addEventListener('click', onClick);
  return node;
}

export function postCard(post, query = '') {
  const href = `#/blog/${post.slug}`;
  return el('article.post-card', {}, [
    post.cover
      ? el('img', {
          src: post.cover,
          alt: '',
          loading: 'lazy',
          style: { borderRadius: '10px', aspectRatio: '16/9', objectFit: 'cover' },
        })
      : null,
    el('div.meta', {}, [
      post.category ? badge(post.category.name, 'brand') : null,
      post.status === 'draft' ? badge('草稿', 'warning') : null,
      post.featured ? badge('精选', 'success') : null,
      el('span', {}, timeAgo(post.publishedAt || post.createdAt)),
      el('span', {}, '·'),
      el('span', {}, `${post.readingTime} 分钟阅读`),
    ]),
    el('h3', {}, el('a', { href, html: highlight(post.title, query) })),
    el('p.clamp-2', { html: highlight(post.excerpt || '', query) }),
    post.tags?.length
      ? el(
          'div.tags',
          {},
          post.tags.map((t) => el('a.badge', { href: `#/blog?tag=${t.slug}` }, `#${t.name}`)),
        )
      : null,
    el('div.row', { style: { marginTop: 'auto', paddingTop: '6px' } }, [
      avatar(post.author, 'sm'),
      el('span.small.muted.truncate', {}, post.author.nickname || post.author.username),
      el('span.grow'),
      el('span.small.muted.nowrap', {}, `👁 ${numberFmt(post.views)}  ♥ ${post.likes}`),
    ]),
  ]);
}
