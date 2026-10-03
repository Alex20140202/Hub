import { escapeHtml, icon, initials, attr } from './html.js';
import { formatBytes, formatNumber, fromNow, formatDate, hostname } from './format.js';
import { renderMarkdown, summarize } from './markdown.js';
import { pageHead, empty, statCard, pager, queryHref as buildQuery } from './shared.js';

export { pageHead, empty, statCard, pager };

/* --------------------------------- 片段助手 --------------------------------- */

const avatar = (name, hue, size = '', frame = '') =>
  `<span class="avatar${size ? ` avatar-${size}` : ''}" style="--hue:${Number(hue) || 210}"${frame ? ` data-frame="${escapeHtml(frame)}"` : ''}>${escapeHtml(initials(name))}</span>`;

const byline = (post) => `<span class="byline">
  ${avatar(post.authorName, post.authorHue, 'sm', post.authorFrame)}
  <a href="/u/${attr(post.authorUsername)}">${escapeHtml(post.authorName)}</a>
  <span class="dot">·</span><time>${escapeHtml(formatDate(post.publishedAt ?? post.createdAt))}</time>
  <span class="dot">·</span><span>${formatNumber(post.views)} 阅读</span>
</span>`;

const postCard = (post, { compact = false } = {}) => `<article class="post-card" style="--cover:${post.coverHue}">
  <a class="post-cover" href="/blog/${attr(post.slug)}" aria-hidden="true" tabindex="-1"><span>${escapeHtml((post.categoryName || '未分类').slice(0, 2))}</span></a>
  <div class="post-body">
    <div class="post-meta">
      ${post.categoryName ? `<a class="tag" href="/blog?category=${encodeURIComponent(post.categorySlug)}">${escapeHtml(post.categoryName)}</a>` : ''}
      ${post.featured ? '<em class="badge tone-amber">精选</em>' : ''}
      ${post.status === 'draft' ? '<em class="badge">草稿</em>' : ''}
    </div>
    <h3><a href="/blog/${attr(post.slug)}">${escapeHtml(post.title)}</a></h3>
    ${compact ? '' : `<p class="post-excerpt">${escapeHtml(post.excerpt || summarize(post.body))}</p>`}
    <footer>
      ${byline(post)}
      <span class="post-stats">
        <span title="评论">💬 ${formatNumber(post.commentCount ?? 0)}</span>
        <span title="点赞">♥ ${formatNumber(post.likeCount ?? 0)}</span>
      </span>
    </footer>
  </div>
</article>`;

/* --------------------------------- 站点首页 --------------------------------- */

export function homePage(ctx) {
  const { data, user } = ctx;
  const { settings, site, featured, latest, hot, mine } = data;

  return `${pageHead(
    user ? `${user.nickname}，欢迎回来` : settings.site_name,
    user ? `已连续活跃 ${data.streak} 天 · 积分 ${formatNumber(data.balance)} · 排名 ${data.rank ? `第 ${data.rank} 位` : '未上榜'}` : settings.site_tagline,
    user
      ? `<div class="row-actions">
           <a class="btn" href="/blog/new">${icon('notes', 16)}写文章</a>
           <button class="btn btn-primary" type="button" data-action="quick-add">${icon('plus', 16)}新建</button>
         </div>`
      : `<div class="row-actions"><a class="btn btn-primary" href="/register">创建账号</a><a class="btn" href="/login">登录</a></div>`,
  )}

  <section class="stat-grid">
    ${statCard({ label: '站内文章', value: formatNumber(site.posts), hint: `${site.tags.length} 个热门标签`, tone: 'tone-indigo' })}
    ${statCard({ label: '注册用户', value: formatNumber(site.users), hint: `聊天室 ${site.chat.online} 人在线`, tone: 'tone-emerald' })}
    ${statCard({ label: '聊天室消息', value: formatNumber(site.chat.messages), hint: '实时 WebSocket', tone: 'tone-cyan' })}
    ${statCard({
      label: '我的余额',
      value: user ? formatNumber(data.balance) : '—',
      hint: user ? (data.rank ? `积分排行第 ${data.rank}` : '去签到领积分') : '登录后可见',
      tone: 'tone-amber',
    })}
  </section>

  ${
    user
      ? `<div class="quick-links">
          ${[
            ['/notes', 'notes', '笔记', `${mine.notes} 条`],
            ['/todos', 'todos', '待办', '去处理'],
            ['/links', 'links', '书签', '去收藏'],
            ['/files', 'files', '文件', formatBytes(mine.storage)],
            ['/short', 'short', '短链', '去创建'],
            ['/points', 'points', '积分', formatNumber(mine.balance)],
            ['/chat', 'chat', '聊天室', `${site.chat.online} 在线`],
            ['/blog/new', 'editor', '写作', '写文章'],
          ]
            .map(
              ([href, ic, label, hint]) => `<a class="quick-card" href="${href}">
                ${icon(ic, 20)}<strong>${label}</strong><span>${escapeHtml(hint)}</span>
              </a>`,
            )
            .join('')}
         </div>`
      : `<section class="card">
          <div class="card-head"><h3>这个站点能做什么</h3></div>
          <div class="feature-grid">
            ${[
              ['博客与写作', 'Markdown 写作、分类标签、评论互动、点赞收藏、草稿与精选。'],
              ['个人工作台', '笔记、待办、书签、文件上传与用量统计，一处收纳。'],
              ['短链与图床', '自定义短链带点击统计，文件可设为公开分享。'],
              ['实时聊天室', '手写 WebSocket，无需任何依赖，在线人数与消息持久化。'],
              ['积分与商城', '签到、赚积分、排行榜，兑换主题皮肤与头像框等道具。'],
              ['管理后台', '用户、角色、评论审核、站点设置与内容运营。'],
            ]
              .map(([t, d]) => `<article class="feature"><h3>${escapeHtml(t)}</h3><p>${escapeHtml(d)}</p></article>`)
              .join('')}
          </div>
          <form class="subscribe" data-form="subscribe">
            <label class="field"><span>订阅更新通知</span>
              <div class="subscribe-row">
                <input class="input" type="email" name="email" placeholder="you@example.com" required>
                <button class="btn btn-primary" type="submit">订阅</button>
              </div>
            </label>
          </form>
        </section>`
  }

  ${
    featured.length
      ? `<section class="card">
          <div class="card-head"><h3>精选文章</h3><a class="link-more" href="/blog?sort=hot">更多</a></div>
          <div class="post-grid">${featured.map((post) => postCard(post, { compact: true })).join('')}</div>
        </section>`
      : ''
  }

  <div class="split">
    <section class="card">
      <div class="card-head"><h3>最新发布</h3><a class="link-more" href="/blog">全部文章</a></div>
      ${
        latest.length
          ? `<ul class="post-feed">${latest.map((post) => `<li class="feed-item">${postCard(post, { compact: true })}</li>`).join('')}</ul>`
          : empty('还没有文章', '成为第一个发布的人', user ? '<a class="btn btn-primary" href="/blog/new">写第一篇</a>' : '<a class="btn btn-primary" href="/register">注册后发布</a>')
      }
    </section>

    <section class="card">
      <div class="card-head"><h3>热门文章</h3></div>
      ${
        hot.length
          ? `<ol class="rank-list">${hot
              .map(
                (post, index) => `<li>
                  <span class="rank-no">${index + 1}</span>
                  <span class="rank-body">
                    <a href="/blog/${attr(post.slug)}">${escapeHtml(post.title)}</a>
                    <span class="row-meta">${formatNumber(post.views)} 阅读 · ${formatNumber(post.commentCount ?? 0)} 评论</span>
                  </span>
                </li>`,
              )
              .join('')}</ol>`
          : empty('暂无热门', '')
      }
      <div class="card-head" style="margin-top:24px"><h3>热门标签</h3></div>
      <div class="chips">${
        site.tags.length
          ? site.tags.map((tag) => `<a class="chip" href="/blog?tag=${encodeURIComponent(tag.name)}">${escapeHtml(tag.name)}<span>${tag.count}</span></a>`).join('')
          : '<span class="hint">暂无标签</span>'
      }</div>
      ${
        site.categories.length
          ? `<div class="card-head" style="margin-top:20px"><h3>分类</h3></div>
             <div class="chips">${site.categories.map((c) => `<a class="chip" href="/blog?category=${encodeURIComponent(c.slug)}">${escapeHtml(c.name)}<span>${c.id ? '' : ''}</span></a>`).join('')}</div>`
          : ''
      }
    </section>
  </div>

  <section class="card chat-teaser">
    <div class="card-head"><h3>实时聊天室</h3><a class="link-more" href="/chat">进入 →</a></div>
    <p class="card-text">当前 <strong>${site.chat.online}</strong> 人在线，站内共 <strong>${formatNumber(site.chat.messages)}</strong> 条消息。支持 <code>/help</code>、<code>/who</code>、<code>/time</code> 指令。</p>
    <div class="chips"><a class="chip" href="/chat"># 大厅</a><a class="chip" href="/chat"># 公告</a></div>
  </section>`;
}

/* ---------------------------------- 博客列表 ---------------------------------- */

export function blogPage(ctx) {
  const { data } = ctx;
  const { items, total, page, pages, categories, tags } = data;
  const q = ctx.query;

  return `${pageHead(
    '博客',
    `共 ${formatNumber(total)} 篇文章${q.q ? ` · 搜索「${q.q}」` : ''}${q.tag ? ` · 标签 ${q.tag}` : ''}${q.category ? ` · 分类 ${q.category}` : ''}`,
    `<a class="btn btn-primary" href="/blog/new">${icon('plus', 16)}写文章</a>`,
  )}

  <form class="toolbar" data-search-form>
    <input class="input" type="search" name="q" value="${attr(q.q ?? '')}" placeholder="搜索标题或正文" data-filter="blog">
    <div class="chips">
      ${[['recent', '最新'], ['hot', '最热'], ['liked', '最多点赞'], ['title', '标题']]
        .map(([value, label]) => `<a class="chip${(q.sort ?? 'recent') === value ? ' is-active' : ''}" href="${buildQuery(q, { sort: value })}">${label}</a>`)
        .join('')}
    </div>
  </form>

  <div class="filter-row">
    ${
      categories.length
        ? `<div class="chips"><a class="chip${!q.category ? ' is-active' : ''}" href="${buildQuery(q, { category: '' })}">全部分类</a>${categories
            .map((c) => `<a class="chip${q.category === c.slug ? ' is-active' : ''}" href="${buildQuery(q, { category: c.slug })}">${escapeHtml(c.name)}</a>`)
            .join('')}</div>`
        : ''
    }
    ${
      tags.length
        ? `<div class="chips">${tags
            .slice(0, 12)
            .map((tag) => `<a class="chip${q.tag === tag.name ? ' is-active' : ''}" href="${buildQuery(q, { tag: tag.name })}">${escapeHtml(tag.name)}<span>${tag.count}</span></a>`)
            .join('')}</div>`
        : ''
    }
  </div>

  ${
    items.length
      ? `<div class="post-grid">${items.map((post) => postCard(post)).join('')}</div>`
      : empty(q.q ? '没有匹配的文章' : '还没有文章', q.q ? '换个关键词试试' : '点击右上角写第一篇')
  }

  ${pager({ page, pages, href: (n) => buildQuery(q, { page: n }) })}`;
}

/* --------------------------------- 文章详情 --------------------------------- */

export function postPage(ctx) {
  const { post, comments, outline: toc } = ctx.data;
  const canEdit = ctx.user && (ctx.user.id === post.authorId || ctx.user.role === 'admin');

  return `<div class="page-head">
    <a class="back" href="/blog">${icon('notes', 15)} 返回博客</a>
    <div class="row-actions">
      ${
        canEdit
          ? `<a class="btn" href="/blog/${post.id}/edit">编辑</a>
             <button class="btn btn-ghost-danger" type="button" data-action="delete-post" data-id="${post.id}">删除</button>`
          : ''
      }
    </div>
  </div>

  <div class="post-layout">
    <article class="post-view" style="--cover:${post.coverHue}">
      <header class="post-head">
        <div class="post-meta">
          ${post.categoryName ? `<a class="tag" href="/blog?category=${attr(post.categorySlug)}">${escapeHtml(post.categoryName)}</a>` : ''}
          ${post.status === 'draft' ? '<em class="badge">草稿（仅自己可见）</em>' : ''}
          ${post.featured ? '<em class="badge tone-amber">精选</em>' : ''}
        </div>
        <h1>${escapeHtml(post.title)}</h1>
        <p class="post-lede">${escapeHtml(post.excerpt || summarize(post.body, 160))}</p>
        <div class="post-byline">
          ${byline(post)}
          <span class="post-stats">
            <span>${formatNumber(post.views)} 阅读</span>
            <span>${formatNumber(post.commentCount ?? comments.length)} 评论</span>
            <span>${formatNumber(post.wordCount)} 字</span>
          </span>
        </div>
        <div class="post-actions">
          <button class="btn${post.liked ? ' is-liked' : ''}" type="button" data-action="like-post" data-id="${post.id}">♥ <span data-like-count>${formatNumber(post.likeCount ?? 0)}</span></button>
          <button class="btn${post.bookmarked ? ' is-liked' : ''}" type="button" data-action="bookmark-post" data-id="${post.id}">${post.bookmarked ? '已收藏' : '收藏'} <span data-bookmark-count>${formatNumber(post.bookmarkCount ?? 0)}</span></button>
          <a class="btn" href="#comments">💬 评论</a>
        </div>
      </header>
      <div class="md">${renderMarkdown(post.body)}</div>
    </article>

    ${
      toc.length
        ? `<aside class="toc">
            <h4>目录</h4>
            <ol>${toc.map((item) => `<li class="lv${item.level}"><a href="#${attr(item.id)}">${escapeHtml(item.text)}</a></li>`).join('')}</ol>
           </aside>`
        : ''
    }
  </div>

  ${
    post.tags.length
      ? `<div class="chips">${post.tags.map((tag) => `<a class="tag" href="/blog?tag=${encodeURIComponent(tag)}"># ${escapeHtml(tag)}</a>`).join('')}</div>`
      : ''
  }

  <section class="card" id="comments">
    <div class="card-head"><h3>评论（${comments.length}）</h3></div>
    ${
      comments.length
        ? `<ul class="comment-list">${comments.map(commentItem).join('')}</ul>`
        : '<p class="hint">还没有评论，来抢沙发。</p>'
    }
    <form class="form comment-form" data-form="comment" data-post="${post.id}">
      ${
        ctx.user
          ? `<label class="field"><span>发表评论</span><textarea class="input" name="body" rows="3" maxlength="2000" required placeholder="友善一点～"></textarea></label>`
          : `<label class="field"><span>你的昵称</span><input class="input" name="guestName" maxlength="24" required placeholder="匿名读者"></label>
             <label class="field"><span>评论内容</span><textarea class="input" name="body" rows="3" maxlength="2000" required></textarea></label>
             <p class="hint">游客评论会进入待审核队列，登录用户评论直接展示。</p>`
      }
      <button class="btn btn-primary" type="submit">提交评论</button>
    </form>
  </section>`;
}

const commentItem = (comment) => `<li class="comment${comment.pending ? ' is-pending' : ''}" data-comment="${comment.id}">
  ${avatar(comment.nickname || comment.guestName || '匿', comment.avatarHue)}
  <div class="comment-body">
    <div class="comment-head">
      <strong>${escapeHtml(comment.nickname || comment.guestName || '匿名读者')}</strong>
      ${comment.pending ? '<em class="badge">待审核</em>' : ''}
      <time>${escapeHtml(fromNow(comment.createdAt))}</time>
      <button class="icon-btn" type="button" data-action="like-comment" data-id="${comment.id}" title="点赞">♥ <span>${formatNumber(comment.likeCount ?? 0)}</span></button>
    </div>
    <p>${escapeHtml(comment.body)}</p>
  </div>
</li>`;

/* ---------------------------------- 编辑器 ---------------------------------- */

export function editorPage(ctx) {
  const post = ctx.data.post ?? null;
  const editing = Boolean(post?.id);

  return `${pageHead(editing ? '编辑文章' : '写文章', editing ? `正在编辑《${post.title}》` : '支持 Markdown 语法，写完可存草稿或直接发布')}
  <form class="editor" data-form="post" data-id="${post?.id ?? ''}">
    <div class="editor-main card">
      <input class="editor-title" name="title" placeholder="文章标题" maxlength="160" required value="${attr(post?.title ?? '')}">
      <textarea class="editor-body" name="body" rows="18" placeholder="用 Markdown 写正文…&#10;&#10;## 二级标题&#10;- 列表项&#10;**粗体** / *斜体* / \`代码\`">${escapeHtml(post?.body ?? '')}</textarea>
      <div class="editor-meta">
        <label class="field"><span>分类</span><input class="input" name="category" value="${attr(post?.categoryName ?? '')}" placeholder="留空则未分类" maxlength="40"></label>
        <label class="field"><span>标签（空格分隔）</span><input class="input" name="tags" value="${attr((post?.tags ?? []).join(' '))}" placeholder="例如 Node.js 实践" maxlength="200"></label>
        <label class="field"><span>摘要（留空自动截取）</span><input class="input" name="excerpt" value="${attr(post?.excerpt ?? '')}" maxlength="300"></label>
        <label class="field"><span>封面色相</span><input type="range" name="coverHue" min="0" max="359" value="${Number(post?.coverHue ?? 220)}"></label>
      </div>
    </div>
    <aside class="editor-side">
      <div class="card">
        <div class="card-head"><h3>发布</h3></div>
        <div class="form">
          <button class="btn btn-primary" type="submit" name="status" value="published">${editing ? '更新并保持发布' : '立即发布'}</button>
          <button class="btn" type="submit" name="status" value="draft">存为草稿</button>
        </div>
        <p class="hint">发布可得 <strong>+20</strong> 积分，评论区每条 <strong>+3</strong>。</p>
      </div>
      <div class="card">
        <div class="card-head"><h3>实时预览</h3></div>
        <div class="md editor-preview" data-preview><p class="hint">开始输入即可预览</p></div>
      </div>
    </aside>
  </form>`;
}

export { postCard, byline, avatar };
