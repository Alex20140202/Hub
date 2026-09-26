import { el, clear } from '../lib/dom.js';
import { store, requireLogin } from '../lib/store.js';
import { PostAPI } from '../lib/api.js';
import { go, refresh } from '../lib/router.js';
import { numberFmt, dateTime, timeAgo, relativeDate } from '../lib/format.js';
import { markdownToHtml } from '../lib/markdown.js';
import { avatar, badge, empty, skeleton, statusBadge } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import { postCard } from './blog.js';

export default async function postView(host, ctx) {
  host.replaceChildren(skeleton(4, { title: true }));

  let data;
  try {
    data = await PostAPI.get(ctx.params.slug);
  } catch (err) {
    host.replaceChildren(
      empty('文章不存在', err.message, el('a.btn.btn-primary', { href: '#/blog' }, '返回博客'), '🔍'),
    );
    return;
  }

  const { post, adjacent, related, comments, liked } = data;
  document.title = `${post.title} · ${store.settings.site_name}`;

  const isAuthor = store.user && (post.author.id === store.user.id || store.user.role === 'admin');

  /* ---------- 头部 ---------- */
  const header = el('header.container', { style: { paddingTop: '36px', maxWidth: '860px' } }, [
    el('div.row.wrap', { style: { marginBottom: '14px' } }, [
      post.category ? el('a.badge.badge-brand', { href: `#/blog?category=${post.category.slug}` }, post.category.name) : null,
      statusBadge(post.status),
      post.featured ? badge('精选', 'success') : null,
      ...(post.tags || []).map((t) => el('a.badge', { href: `#/blog?tag=${t.slug}` }, `#${t.name}`)),
    ]),
    el('h1', { style: { fontSize: 'var(--step-3)' } }, post.title),
    post.excerpt ? el('p.soft', { style: { marginTop: '10px', fontSize: '1.05rem' } }, post.excerpt) : null,
    el('div.row.wrap', { style: { marginTop: '20px', paddingBottom: '22px', borderBottom: '1px solid var(--border)' } }, [
      avatar(post.author, 'lg'),
      el('div', {}, [
        el('a', { href: `#/u/${post.author.username}`, style: { fontWeight: '700', color: 'var(--text)' } }, post.author.nickname || post.author.username),
        el('div.small.muted', {}, `发布于 ${dateTime(post.publishedAt || post.createdAt)} · ${post.readingTime} 分钟阅读`),
      ]),
      el('span.grow'),
      el('div.row', {}, [
        el('button.btn.btn-ghost.btn-sm', { type: 'button', id: 'like-btn', onclick: () => toggleLike() },
          `${liked ? '❤️' : '🤍'} ${post.likes}`),
        store.user
          ? el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: toggleBookmark }, '🔖 收藏')
          : null,
        el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: copyLink }, '🔗 复制链接'),
        isAuthor
          ? el('a.btn.btn-ghost.btn-sm', { href: `#/blog/${post.slug}/edit` }, '✏️ 编辑')
          : null,
        isAuthor
          ? el('button.btn.btn-outline-danger.btn-sm', { type: 'button', onclick: removePost }, '🗑 删除')
          : null,
      ]),
    ]),
  ]);

  /* ---------- 正文 ---------- */
  const article = el('article.prose', { html: markdownToHtml(post.content) });

  /* ---------- 目录 ---------- */
  const toc = buildToc(post.content);

  const body = el('div.container', { style: { display: 'grid', gridTemplateColumns: toc ? 'minmax(0,1fr) 220px' : '1fr', gap: '36px', paddingBlock: '32px' } }, [
    el('div', { style: { minWidth: '0' } }, [article, commentSection(post, comments, isAuthor)]),
    toc
      ? el('aside', { style: { position: 'sticky', top: 'calc(var(--header-h) + 20px)', alignSelf: 'start' } }, [
          el('div.card.pad-sm', {}, [
            el('div.card-title', { style: { fontSize: '0.85rem' } }, '目录'),
            el('nav.col', { style: { gap: '6px' } },
              toc.map((h) =>
                el('a.small', {
                  href: `#${h.id}`,
                  style: { paddingLeft: `${(h.level - 2) * 10}px`, color: 'var(--text-soft)' },
                  onclick: (e) => {
                    e.preventDefault();
                    document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  },
                }, h.text),
              ),
            ),
          ]),
        ])
      : null,
  ]);

  /* ---------- 上一篇 / 下一篇 ---------- */
  const nav = el('div.container', { style: { maxWidth: '860px', paddingBottom: '30px' } }, [
    el('div.grid.grid-2', {}, [
      adjacent.prev
        ? el('a.card.hover', { href: `#/blog/${adjacent.prev.slug}` }, [
            el('div.small.muted', {}, '← 上一篇'),
            el('div', { style: { fontWeight: '600', marginTop: '4px' } }, adjacent.prev.title),
          ])
        : el('div'),
      adjacent.next
        ? el('a.card.hover', { href: `#/blog/${adjacent.next.slug}`, style: { textAlign: 'right' } }, [
            el('div.small.muted', {}, '下一篇 →'),
            el('div', { style: { fontWeight: '600', marginTop: '4px' } }, adjacent.next.title),
          ])
        : el('div'),
    ]),
  ]);

  /* ---------- 相关推荐 ---------- */
  const relatedSection = related.length
    ? el('section.section.container', { style: { maxWidth: '1100px' } }, [
        el('div.section-head', {}, el('h2', {}, '相关推荐')),
        el('div.grid.grid-3', {}, related.map((p) => postCard(p))),
      ])
    : null;

  host.replaceChildren(header, body, nav, relatedSection);

  /* ---------- 交互 ---------- */
  async function toggleLike() {
    if (!requireLogin(`/blog/${post.slug}`)) return;
    try {
      const res = await PostAPI.like(post.id);
      post.likes = res.likes;
      document.getElementById('like-btn').textContent = `${res.active ? '❤️' : '🤍'} ${res.likes}`;
      if (res.active) toast.success('已点赞');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function toggleBookmark() {
    try {
      const res = await PostAPI.bookmark(post.id);
      toast.success(res.bookmarked ? '已加入收藏' : '已取消收藏');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function copyLink() {
    const url = `${location.origin}/#/blog/${post.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('链接已复制');
    } catch {
      toast.warning('复制失败，请手动复制地址栏');
    }
  }

  async function removePost() {
    if (!(await confirmDialog({
      title: '删除文章',
      message: `确定要删除《${post.title}》吗？此操作不可恢复，关联的评论也会一并删除。`,
      confirmText: '删除',
      danger: true,
    }))) return;
    try {
      await PostAPI.remove(post.id);
      toast.success('文章已删除');
      go('/blog');
    } catch (err) {
      toast.error(err.message);
    }
  }
}

/* ---------------- 评论 ---------------- */
function commentSection(post, comments, isAuthor) {
  const wrap = el('section', { style: { marginTop: '48px', paddingTop: '28px', borderTop: '1px solid var(--border)' } });
  const count = comments.reduce((s, c) => s + 1 + (c.replies?.length || 0), 0);
  const listNode = el('div');
  const formNode = el('div');

  wrap.append(
    el('h2', { style: { fontSize: '1.3rem', marginBottom: '16px' } }, `评论 · ${count}`),
    formNode,
    el('div', { style: { marginTop: '20px' } }, listNode),
  );

  renderComments(listNode, comments, post, isAuthor);
  renderForm(formNode, post, () => refresh());

  return wrap;
}

function renderComments(node, comments, post, isAuthor) {
  node.replaceChildren();
  if (!comments.length) {
    node.append(el('div.empty', { style: { padding: '28px' } }, [el('p', {}, '还没有评论，来抢沙发吧')]));
    return;
  }
  const total = comments.reduce((s, c) => s + 1 + (c.replies?.length || 0), 0);
  if (total > 5) {
    node.append(
      el('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        style: { marginBottom: '12px' },
        onclick: (e) => {
          node.replaceChildren();
          for (const c of comments) node.append(commentItem(c, post, isAuthor, 0));
          e.currentTarget.remove();
        },
      }, `展开全部 ${total} 条评论`),
    );
  }
  for (const c of comments) node.append(commentItem(c, post, isAuthor, 0));
}

function commentItem(comment, post, isAuthor, depth) {
  const bodyNode = el('div.grow', {}, [
    el('div.row', { style: { gap: '8px' } }, [
      el('a', { href: comment.author.username ? `#/u/${comment.author.username}` : '#', style: { fontWeight: '600', color: 'var(--text)' } },
        comment.author.nickname || '匿名'),
      comment.author.role === 'admin' ? badge('站主', 'brand') : null,
      el('span.small.muted', {}, timeAgo(comment.createdAt)),
    ]),
    el('div', { style: { marginTop: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, comment.body),
    el('div.row', { style: { marginTop: '6px' } }, [
      store.user
        ? el('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            onclick: () => reply(),
          }, '回复')
        : el('a.btn.btn-ghost.btn-sm', { href: '#/login' }, '登录后回复'),
      canDelete(comment)
        ? el('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            onclick: async () => {
              if (!(await confirmDialog({ title: '删除评论', message: '确定删除这条评论？', confirmText: '删除', danger: true }))) return;
              try {
                await PostAPI.removeComment(comment.id);
                toast.success('评论已删除');
                refresh();
              } catch (err) {
                toast.error(err.message);
              }
            },
          }, '删除')
        : null,
    ]),
  ]);

  const replyBox = el('div', { style: { marginTop: '10px', display: 'none' } });
  function reply() {
    if (!store.user) return;
    if (replyBox.firstChild) {
      replyBox.replaceChildren();
      return;
    }
    const input = el('textarea.textarea', { rows: 3, placeholder: `回复 ${comment.author.nickname}…` });
    const submit = el('button.btn.btn-primary.btn-sm', { type: 'button' }, '发送回复');
    submit.addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text) return;
      submit.setAttribute('aria-busy', 'true');
      try {
        await PostAPI.addComment(post.id, { body: text, parentId: comment.id });
        toast.success('回复已发布');
        refresh();
      } catch (err) {
        toast.error(err.message);
        submit.removeAttribute('aria-busy');
      }
    });
    replyBox.replaceChildren(el('div.col', { style: { gap: '8px' } }, [input, el('div.row', {}, [submit])]));
  }

  return el('div.comment', {}, [
    avatar(comment.author, 'sm'),
    el('div.body', {}, [bodyNode, replyBox, (comment.replies || []).length && depth < 1
      ? el('div.replies', {}, comment.replies.map((r) => commentItem(r, post, isAuthor, depth + 1)))
      : null]),
  ]);

  function canDelete(c) {
    if (!store.user) return false;
    return store.user.role === 'admin' || c.author.id === store.user.id || isAuthor;
  }
}

function renderForm(node, post, onDone) {
  node.replaceChildren();
  if (!store.user) {
    node.append(
      el('div.alert.alert-info', {}, [
        '登录后即可参与讨论。',
        el('a', { href: `#/login?next=${encodeURIComponent(`/blog/${post.slug}`)}` }, ' 去登录'),
      ]),
    );
    return;
  }
  const input = el('textarea.textarea', { rows: 4, placeholder: '写下你的看法…（支持 Markdown）' });
  const submit = el('button.btn.btn-primary', { type: 'button' }, '发表评论');
  submit.addEventListener('click', async () => {
    const body = input.value.trim();
    if (!body) return toast.warning('评论内容不能为空');
    submit.setAttribute('aria-busy', 'true');
    try {
      const res = await PostAPI.addComment(post.id, { body });
      toast.success(res.message || '评论已发布');
      onDone();
    } catch (err) {
      toast.error(err.message);
      submit.removeAttribute('aria-busy');
    }
  });
  node.append(el('div.comment-form', {}, [input, el('div.row', {}, [submit])]));
}

/* ---------------- 目录 ---------------- */
function buildToc(markdown) {
  const headings = [];
  const lines = String(markdown || '').split('\n');
  let inCode = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const m = /^(#{2,3})\s+(.*)$/.exec(line);
    if (!m) continue;
    const text = m[2].trim().replace(/[*_`]/g, '');
    const id = text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    headings.push({ level: m[1].length, text, id });
  }
  return headings.length >= 2 ? headings : null;
}
