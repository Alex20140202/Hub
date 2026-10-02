import { escapeHtml, icon, initials, attr } from './html.js';
import { formatBytes, formatNumber, fromNow, formatDate, hostname } from './format.js';
import { globalSearch } from '../models/search.js';
import { config } from '../config.js';

/* --------------------------------- 通用片段 --------------------------------- */

const pageHead = (title, subtitle, action = '') =>
  `<div class="page-head">
    <div><h2 class="page-heading">${escapeHtml(title)}</h2>${subtitle ? `<p class="page-sub">${escapeHtml(subtitle)}</p>` : ''}</div>
    ${action}
  </div>`;

const empty = (title, hint, action = '') =>
  `<div class="empty">
     <div class="empty-mark" aria-hidden="true">${icon('notes', 26)}</div>
     <p class="empty-title">${escapeHtml(title)}</p>
     ${hint ? `<p class="empty-hint">${escapeHtml(hint)}</p>` : ''}
     ${action}
   </div>`;

const statCard = ({ label, value, hint, tone = '' }) =>
  `<div class="stat ${tone}">
     <span class="stat-label">${escapeHtml(label)}</span>
     <strong class="stat-value">${escapeHtml(value)}</strong>
     ${hint ? `<span class="stat-hint">${escapeHtml(hint)}</span>` : ''}
   </div>`;

/* --------------------------------- 仪表盘 --------------------------------- */

export function dashboard(ctx) {
  const { user } = ctx;
  const trend = ctx.data.trend;
  const peak = Math.max(1, ...trend.map((point) => point.count));

  const spark = trend
    .map((point, index) => {
      const x = (index / (trend.length - 1)) * 100;
      const y = 34 - (point.count / peak) * 30;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  const area = `0,34 ${spark} 100,34`;

  return `${pageHead(
    `${user.nickname}，欢迎回来`,
    `已连续活跃 ${ctx.data.streak} 天 · 今天是你在 Hub 的第 ${Math.max(1, Math.round((Date.now() - new Date(`${user.createdAt.replace(' ', 'T')}Z`)) / 86400000)) + 1} 天`,
    `<button class="btn btn-primary" type="button" data-action="quick-add">${icon('plus', 16)}新建</button>`,
  )}

  <section class="stat-grid">
    ${statCard({ label: '笔记', value: formatNumber(ctx.data.notes.total), hint: `${ctx.data.recentNotes.length} 条最近更新`, tone: 'tone-indigo' })}
    ${statCard({ label: '待办', value: formatNumber(ctx.data.todos.open), hint: ctx.data.todos.overdue ? `${ctx.data.todos.overdue} 项已逾期` : '没有逾期项', tone: ctx.data.todos.overdue ? 'tone-rose' : 'tone-emerald' })}
    ${statCard({ label: '书签', value: formatNumber(ctx.data.links.total), hint: `累计点击 ${formatNumber(ctx.data.links.clicks)} 次`, tone: 'tone-cyan' })}
    ${statCard({ label: '文件', value: formatNumber(ctx.data.files.total), hint: `占用 ${formatBytes(ctx.data.files.used)}`, tone: 'tone-amber' })}
  </section>

  <section class="card chart-card">
    <div class="card-head">
      <h3>近 14 天活跃度</h3>
      <span class="badge">峰值 ${peak}</span>
    </div>
    <svg class="spark" viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label="近 14 天活跃趋势">
      <defs><linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity=".34"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="${area}" fill="url(#spark-fill)"></polygon>
      <polyline points="${spark}" fill="none" stroke="var(--accent)" stroke-width="1.2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"></polyline>
    </svg>
    <div class="spark-axis"><span>${escapeHtml(trend[0]?.day.slice(5) ?? '')}</span><span>今天</span></div>
  </section>

  <div class="split">
    <section class="card">
      <div class="card-head"><h3>最近笔记</h3><a class="link-more" href="/notes">全部</a></div>
      ${
        ctx.data.recentNotes.length
          ? `<ul class="list">${ctx.data.recentNotes.map(noteRow).join('')}</ul>`
          : empty('还没有笔记', '把想法记下来，之后随时可以搜索到')
      }
    </section>
    <section class="card">
      <div class="card-head"><h3>接下来要做</h3><a class="link-more" href="/todos">全部</a></div>
      ${
        ctx.data.upcoming.length
          ? `<ul class="list">${ctx.data.upcoming.map(todoRow).join('')}</ul>`
          : empty('待办已清空', '保持这个节奏')
      }
    </section>
  </div>

  <div class="split">
    <section class="card">
      <div class="card-head"><h3>常用书签</h3><a class="link-more" href="/links">全部</a></div>
      ${
        ctx.data.topLinks.length
          ? `<ul class="list">${ctx.data.topLinks.map(linkRow).join('')}</ul>`
          : empty('还没有书签', '收藏常去的站点')
      }
    </section>
    <section class="card">
      <div class="card-head"><h3>最近动态</h3></div>
      ${
        ctx.data.activity.length
          ? `<ul class="activity">${ctx.data.activity.map(eventRow).join('')}</ul>`
          : empty('还没有动态', '你的操作会记录在这里')
      }
    </section>
  </div>`;
}

const noteRow = (note) => `<li class="row">
  <a class="row-main" href="/notes/${note.id}">
    <span class="row-title">${escapeHtml(note.title || '无标题笔记')}</span>
    <span class="row-meta">${note.pinned ? '<em class="pin">置顶</em> ' : ''}${escapeHtml(note.tags.join(' · ')) || '无标签'} · ${escapeHtml(fromNow(note.updatedAt))}</span>
  </a>
</li>`;

const todoRow = (todo) => {
  const overdue = todo.dueAt && !todo.done && new Date(todo.dueAt.replace(' ', 'T')) < new Date();
  return `<li class="row">
    <label class="check">
      <input type="checkbox" data-todo-toggle="${todo.id}" ${todo.done ? 'checked' : ''}>
      <span class="check-box" aria-hidden="true"></span>
    </label>
    <span class="row-main">
      <span class="row-title${todo.done ? ' is-done' : ''}">${escapeHtml(todo.title)}</span>
      <span class="row-meta">${priorityBadge(todo.priority)}${todo.dueAt ? ` · <em class="${overdue ? 'danger' : ''}">${escapeHtml(formatDate(todo.dueAt, true))}</em>` : ''}</span>
    </span>
  </li>`;
};

const priorityBadge = (priority) =>
  ({ high: '<em class="badge tone-rose">高</em>', normal: '<em class="badge">中</em>', low: '<em class="badge tone-cyan">低</em>' })[priority] ?? '';

const linkRow = (link) => `<li class="row">
  <a class="row-main" href="${attr(link.url)}" target="_blank" rel="noopener noreferrer" data-link-click="${link.id}">
    <span class="row-title">${escapeHtml(link.title)}</span>
    <span class="row-meta">${escapeHtml(hostname(link.url))} · 点击 ${formatNumber(link.clicks)} 次</span>
  </a>
  ${link.starred ? '<span class="star" aria-label="已收藏">★</span>' : ''}
</li>`;

const EVENT_TEXT = {
  'user.register': '注册了账号',
  'user.login': '登录了站点',
  'user.logout': '退出了登录',
  'user.password': '修改了密码',
  'note.create': '新建了笔记',
  'note.delete': '删除了笔记',
  'note.pin': '置顶了笔记',
  'note.unpin': '取消了置顶',
  'todo.create': '新增了待办',
  'todo.complete': '完成了待办',
  'todo.delete': '删除了待办',
  'todo.clear': '清理了已完成待办',
  'link.create': '收藏了书签',
  'link.delete': '删除了书签',
  'file.upload': '上传了文件',
  'file.download': '下载了文件',
  'file.delete': '删除了文件',
  'admin.settings': '更新了站点设置',
  'admin.role': '调整了用户角色',
  'admin.delete-user': '删除了用户',
};

const eventRow = (event) => `<li class="activity-item">
  <span class="activity-dot" aria-hidden="true"></span>
  <span class="activity-text">${escapeHtml(EVENT_TEXT[event.kind] ?? event.kind)}${event.target ? ` <em>${escapeHtml(event.target)}</em>` : ''}</span>
  <time class="activity-time">${escapeHtml(fromNow(event.createdAt))}</time>
</li>`;

/* ---------------------------------- 笔记 ---------------------------------- */

export function notesPage(ctx) {
  const { items, total, tags } = ctx.data;
  return `${pageHead('笔记', `共 ${total} 条${ctx.query.tag ? ` · 标签「${ctx.query.tag}」` : ''}`, `<button class="btn btn-primary" type="button" data-action="new-note">${icon('plus', 16)}新建笔记</button>`)}
  <div class="toolbar">
    <input class="input" type="search" name="q" value="${attr(ctx.query.q ?? '')}" placeholder="搜索标题、正文或标签" data-filter="notes">
    ${
      tags.length
        ? `<div class="chips">${tags
            .slice(0, 10)
            .map(
              (tag) =>
                `<a class="chip${ctx.query.tag === tag.name ? ' is-active' : ''}" href="/notes?tag=${encodeURIComponent(tag.name)}">${escapeHtml(tag.name)}<span>${tag.count}</span></a>`,
            )
            .join('')}</div>`
        : ''
    }
  </div>
  ${
    items.length
      ? `<div class="note-grid">${items.map(noteCard).join('')}</div>`
      : empty('没有匹配的笔记', ctx.query.q ? '换个关键词试试' : '点击右上角新建第一条笔记')
  }`;
}

const noteCard = (note) => `<article class="note-card tint-${escapeHtml(note.color)}">
  <a class="note-card-link" href="/notes/${note.id}">
    <h3>${note.pinned ? '<span class="pin" title="置顶">置顶</span>' : ''}${escapeHtml(note.title || '无标题笔记')}</h3>
    <p>${escapeHtml(note.body.slice(0, 140) || '（空白笔记）')}</p>
    <footer>
      ${note.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
      <time>${escapeHtml(fromNow(note.updatedAt))}</time>
    </footer>
  </a>
</article>`;

export function noteDetail(ctx) {
  const { note } = ctx.data;
  return `<div class="page-head">
    <a class="back" href="/notes">${icon('notes', 15)} 返回笔记</a>
    <div class="row-actions">
      <button class="btn" type="button" data-action="edit-note" data-id="${note.id}">编辑</button>
      <button class="btn btn-ghost-danger" type="button" data-action="delete-note" data-id="${note.id}">删除</button>
    </div>
  </div>
  <article class="note-view">
    <h2>${escapeHtml(note.title || '无标题笔记')}</h2>
    <div class="note-meta">
      <time>更新于 ${escapeHtml(formatDate(note.updatedAt, true))}</time>
      ${note.tags.map((tag) => `<a class="tag" href="/notes?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`).join('')}
    </div>
    <div class="note-body">${note.body.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>
  </article>`;
}

/* ---------------------------------- 待办 ---------------------------------- */

export function todosPage(ctx) {
  const { items, stats } = ctx.data;
  const filters = [
    ['all', '全部'],
    ['open', '未完成'],
    ['today', '今天到期'],
    ['done', '已完成'],
  ];
  const groups = [
    ['high', '高优先级'],
    ['normal', '普通'],
    ['low', '低优先级'],
  ];

  return `${pageHead('待办', `未完成 ${stats.open} 项 · 已完成 ${stats.done} 项${stats.overdue ? ` · 逾期 ${stats.overdue} 项` : ''}`, `<div class="row-actions">
      <button class="btn" type="button" data-action="clear-completed"${stats.done ? '' : ' disabled'}>清理已完成</button>
      <button class="btn btn-primary" type="button" data-action="new-todo">${icon('plus', 16)}新建</button>
    </div>`)}

  <div class="progress-row">
    <div class="progress"><div class="progress-bar" style="--pct:${stats.total ? Math.round((stats.done / stats.total) * 100) : 0}%"></div></div>
    <span class="progress-label">${stats.total ? Math.round((stats.done / stats.total) * 100) : 0}%</span>
  </div>

  <div class="chips">
    ${filters
      .map(
        ([value, label]) =>
          `<a class="chip${(ctx.query.filter ?? 'all') === value ? ' is-active' : ''}" href="/todos?filter=${value}">${label}</a>`,
      )
      .join('')}
  </div>

  ${
    items.length
      ? `<div class="todo-groups">${groups
          .map(([priority, label]) => {
            const group = items.filter((todo) => todo.priority === priority);
            if (!group.length) return '';
            return `<section class="card">
              <div class="card-head"><h3>${label}</h3><span class="badge">${group.length}</span></div>
              <ul class="list todo-list" data-priority="${priority}">${group.map(todoRow).join('')}</ul>
            </section>`;
          })
          .join('')}</div>`
      : empty('这里空空如也', '所有事项都完成了，或者换个筛选条件')
  }`;
}

/* ---------------------------------- 书签 ---------------------------------- */

export function linksPage(ctx) {
  const { items, stats, tags } = ctx.data;
  return `${pageHead('书签', `${stats.total} 个 · ${stats.starred} 个已标星 · 累计点击 ${formatNumber(stats.clicks)} 次`, `<button class="btn btn-primary" type="button" data-action="new-link">${icon('plus', 16)}新建书签</button>`)}
  <div class="toolbar">
    <input class="input" type="search" name="q" value="${attr(ctx.query.q ?? '')}" placeholder="搜索标题、网址或标签" data-filter="links">
    ${
      tags.length
        ? `<div class="chips">${tags
            .slice(0, 10)
            .map(
              (tag) =>
                `<a class="chip${ctx.query.tag === tag.name ? ' is-active' : ''}" href="/links?tag=${encodeURIComponent(tag.name)}">${escapeHtml(tag.name)}<span>${tag.count}</span></a>`,
            )
            .join('')}</div>`
        : ''
    }
  </div>
  ${
    items.length
      ? `<div class="link-grid">${items.map(linkCard).join('')}</div>`
      : empty('还没有书签', '把常去的网站收进来')
  }`;
}

const linkCard = (link) => `<article class="link-card">
  <div class="link-favicon" aria-hidden="true">${escapeHtml(initials(hostname(link.url)))}</div>
  <div class="link-body">
    <a href="${attr(link.url)}" target="_blank" rel="noopener noreferrer" data-link-click="${link.id}">${escapeHtml(link.title)}</a>
    <span class="link-host">${escapeHtml(hostname(link.url))}</span>
    ${link.description ? `<p>${escapeHtml(link.description)}</p>` : ''}
    <div class="link-foot">
      ${link.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
      <span class="link-clicks">${formatNumber(link.clicks)} 次点击</span>
    </div>
  </div>
  <div class="link-actions">
    <button class="icon-btn" type="button" data-action="star-link" data-id="${link.id}" title="${link.starred ? '取消标星' : '标星'}" aria-label="标星">${link.starred ? '★' : '☆'}</button>
    <button class="icon-btn" type="button" data-action="edit-link" data-id="${link.id}" title="编辑" aria-label="编辑">✎</button>
    <button class="icon-btn" type="button" data-action="delete-link" data-id="${link.id}" title="删除" aria-label="删除">✕</button>
  </div>
</article>`;

/* ---------------------------------- 文件 ---------------------------------- */

export function filesPage(ctx) {
  const { items, storage } = ctx.data;
  const pct = storage.quota ? Math.min(100, Math.round((storage.used / storage.quota) * 100)) : 0;
  return `${pageHead('文件', `${storage.count} 个文件 · 已用 ${formatBytes(storage.used)}`, `<button class="btn btn-primary" type="button" data-action="pick-file">${icon('plus', 16)}上传文件</button>`)}
  <section class="card storage-card">
    <div class="progress"><div class="progress-bar" style="--pct:${pct}%"></div></div>
    <div class="storage-meta">
      <span>${formatBytes(storage.used)} / ${formatBytes(storage.quota)}</span>
      <span>${storage.folders.length} 个目录</span>
    </div>
    <div class="chips">
      <a class="chip${!ctx.query.folder ? ' is-active' : ''}" href="/files">全部</a>
      ${storage.folders
        .map(
          (folder) =>
            `<a class="chip${ctx.query.folder === folder.folder ? ' is-active' : ''}" href="/files?folder=${encodeURIComponent(folder.folder)}">${escapeHtml(folder.folder)}<span>${folder.count}</span></a>`,
        )
        .join('')}
    </div>
  </section>
  <div class="toolbar">
    <input class="input" type="search" name="q" value="${attr(ctx.query.q ?? '')}" placeholder="按文件名或目录搜索" data-filter="files">
    <span class="hint">单个文件上限 ${formatBytes(config.maxUploadBytes)}</span>
  </div>
  ${
    items.length
      ? `<div class="file-grid">${items.map(fileCard).join('')}</div>`
      : empty('还没有文件', '点击右上角上传，或把文件拖到这页')
  }`;
}

const fileCard = (file) => `<article class="file-card">
  <div class="file-icon" aria-hidden="true">${escapeHtml(file.name.split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE')}</div>
  <div class="file-body">
    <strong title="${attr(file.name)}">${escapeHtml(file.name)}</strong>
    <span>${formatBytes(file.size)} · ${escapeHtml(file.folder)} · ${file.downloads} 次下载</span>
  </div>
  <div class="file-actions">
    <a class="icon-btn" href="/api/files/${file.id}/download" title="下载" aria-label="下载">↓</a>
    <button class="icon-btn" type="button" data-action="delete-file" data-id="${file.id}" title="删除" aria-label="删除">✕</button>
  </div>
</article>`;

/* ---------------------------------- 搜索 ---------------------------------- */

export function searchPage(ctx) {
  const term = ctx.query.q ?? '';
  const result = term ? globalSearch(ctx.user.id, term, { scope: ctx.query.scope ?? 'all' }) : { total: 0, groups: [] };
  const scopeLabels = { all: '全部', note: '笔记', todo: '待办', link: '书签', file: '文件' };

  return `${pageHead('搜索', term ? `“${term}” 命中 ${result.total} 条结果` : '跨笔记、待办、书签与文件检索')}
    <form class="toolbar" data-search-form>
      <input class="input input-lg" type="search" name="q" value="${attr(term)}" placeholder="输入关键词后回车" autofocus>
      <div class="chips">
        ${Object.entries(scopeLabels)
          .map(
            ([value, label]) =>
              `<a class="chip${(ctx.query.scope ?? 'all') === value ? ' is-active' : ''}" href="/search?q=${encodeURIComponent(term)}&scope=${value}">${label}</a>`,
          )
          .join('')}
      </div>
    </form>
    ${
      !term
        ? empty('输入关键词开始搜索', '支持标题、正文、网址与文件名')
        : result.total
          ? result.groups
              .map(
                (group) => `<section class="card">
                  <div class="card-head"><h3>${escapeHtml(scopeLabels[group.type] ?? group.type)}</h3><span class="badge">${group.items.length}</span></div>
                  <ul class="list">${group.items
                    .map(
                      (item) => `<li class="row">
                        <a class="row-main" href="${attr(item.href)}">
                          <span class="row-title">${escapeHtml(item.title || '(无标题)')}</span>
                          <span class="row-meta">${escapeHtml((item.excerpt || '').replace(/\s+/g, ' ').slice(0, 90) || '—')}</span>
                        </a>
                      </li>`,
                    )
                    .join('')}</ul>
                </section>`,
              )
              .join('')
          : empty('没有找到结果', '换个关键词，或检查是否有拼写错误')
    }`;
}

/* ---------------------------------- 设置 ---------------------------------- */

export function settingsPage(ctx) {
  const { user, sessions, site } = ctx.data;
  return `${pageHead('设置', '资料、密码、主题与会话管理')}
  <div class="settings-grid">
    <section class="card">
      <div class="card-head"><h3>个人资料</h3></div>
      <form class="form" data-form="profile">
        <div class="avatar-preview"><span class="avatar avatar-lg" style="--hue:${Number(user.avatarHue) || 210}">${escapeHtml(initials(user.nickname))}</span></div>
        <label class="field"><span>昵称</span><input class="input" name="nickname" value="${attr(user.nickname)}" maxlength="24" required></label>
        <label class="field"><span>用户名</span><input class="input" name="username" value="${attr(user.username)}" maxlength="24" required><em>@${escapeHtml(user.username)}</em></label>
        <label class="field"><span>简介</span><textarea class="input" name="bio" rows="3" maxlength="200">${escapeHtml(user.bio)}</textarea></label>
        <label class="field"><span>头像色相</span><input type="range" name="avatarHue" min="0" max="359" value="${Number(user.avatarHue) || 210}"></label>
        <button class="btn btn-primary" type="submit">保存资料</button>
      </form>
    </section>

    <section class="card">
      <div class="card-head"><h3>外观</h3></div>
      <div class="form">
        <div class="field"><span>主题</span>
          <div class="segmented" role="radiogroup" aria-label="主题">
            ${['light', 'dark', 'auto']
              .map((value) => `<button type="button" role="radio" aria-checked="${user.theme === value}" data-theme-set="${value}" class="${user.theme === value ? 'is-active' : ''}">${{ light: '浅色', dark: '深色', auto: '跟随系统' }[value]}</button>`)
              .join('')}
          </div>
        </div>
        <div class="field"><span>主题色</span>
          <div class="swatches" role="radiogroup" aria-label="主题色">
            ${['indigo', 'emerald', 'amber', 'rose', 'cyan', 'violet']
              .map(
                (value) =>
                  `<button type="button" role="radio" aria-label="${value}" aria-checked="${user.accent === value}" data-accent-set="${value}" class="swatch tone-${value}${user.accent === value ? ' is-active' : ''}"></button>`,
              )
              .join('')}
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>修改密码</h3></div>
      <form class="form" data-form="password">
        <label class="field"><span>当前密码</span><input class="input" type="password" name="current" required autocomplete="current-password"></label>
        <label class="field"><span>新密码</span><input class="input" type="password" name="next" required minlength="8" autocomplete="new-password" data-password-meter></label>
        <div class="meter" data-meter hidden><div class="meter-bar"></div><span></span></div>
        <button class="btn btn-primary" type="submit">更新密码</button>
      </form>
    </section>

    <section class="card">
      <div class="card-head"><h3>登录设备</h3><span class="badge">${sessions.length}</span></div>
      <ul class="list">
        ${
          sessions.length
            ? sessions
                .map(
                  (session) => `<li class="row">
                    <span class="row-main">
                      <span class="row-title">${escapeHtml(shortAgent(session.userAgent))}${session.id === ctx.sessionId ? ' <em class="badge">当前</em>' : ''}</span>
                      <span class="row-meta">${escapeHtml(session.ip || '未知地址')} · 最后活动 ${escapeHtml(fromNow(session.lastSeenAt))}</span>
                    </span>
                    ${
                      session.id === ctx.sessionId
                        ? ''
                        : `<button class="btn btn-ghost" type="button" data-action="kill-session" data-id="${escapeHtml(session.id)}">下线</button>`
                    }
                  </li>`,
                )
                .join('')
            : empty('没有其它登录设备', '')
        }
      </ul>
    </section>

    <section class="card">
      <div class="card-head"><h3>数据导出</h3></div>
      <p class="card-text">导出你的全部笔记、待办、书签与文件元数据为 JSON 文件。</p>
      <a class="btn" href="/api/export" download>下载我的数据</a>
    </section>

    ${
      user.role === 'admin'
        ? `<section class="card">
            <div class="card-head"><h3>站点设置</h3></div>
            <form class="form" data-form="site">
              <label class="field"><span>站点名称</span><input class="input" name="site_name" value="${attr(site.site_name)}" maxlength="40"></label>
              <label class="field"><span>站点标语</span><input class="input" name="site_tagline" value="${attr(site.site_tagline)}" maxlength="80"></label>
              <label class="field field-inline"><input type="checkbox" name="allow_registration" ${site.allow_registration === 'true' ? 'checked' : ''}><span>允许新用户注册</span></label>
              <button class="btn btn-primary" type="submit">保存站点设置</button>
            </form>
          </section>`
        : ''
    }
  </div>`;
}

const UA = [
  [/Windows NT/, 'Windows'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Linux/, 'Linux'],
  [/Edg\//, 'Edge'],
  [/Chrome\//, 'Chrome'],
  [/Firefox\//, 'Firefox'],
  [/Safari\//, 'Safari'],
];

function shortAgent(agent) {
  const text = String(agent || '未知设备');
  const os = UA.find(([re]) => re.test(text))?.[1] ?? '未知系统';
  const browser = [...UA].reverse().find(([re]) => re.test(text))?.[1];
  return [os, browser].filter(Boolean).join(' · ') || text.slice(0, 40);
}

/* --------------------------------- 管理后台 --------------------------------- */

export function adminPage(ctx) {
  const { overview: data, users: list, site } = ctx.data;
  return `${pageHead('管理后台', `${data.users} 位用户 · ${data.notes} 条笔记 · ${formatBytes(data.storage)} 存储占用`)}
  <section class="stat-grid">
    ${statCard({ label: '用户', value: formatNumber(data.users), tone: 'tone-indigo' })}
    ${statCard({ label: '笔记', value: formatNumber(data.notes), tone: 'tone-emerald' })}
    ${statCard({ label: '待办', value: formatNumber(data.todos), tone: 'tone-cyan' })}
    ${statCard({ label: '文件', value: formatNumber(data.files), hint: formatBytes(data.storage), tone: 'tone-amber' })}
  </section>

  <section class="card">
    <div class="card-head"><h3>用户管理</h3></div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>用户</th><th>角色</th><th>笔记</th><th>注册时间</th><th></th></tr></thead>
        <tbody>
          ${
            list.length
              ? list
                  .map(
                    (row) => `<tr>
                      <td><span class="cell-user"><span class="avatar avatar-sm" style="--hue:${Number(row.avatarHue) || 210}">${escapeHtml(initials(row.nickname))}</span>${escapeHtml(row.nickname)}<em>@${escapeHtml(row.username)}</em></span></td>
                      <td><span class="badge${row.role === 'admin' ? ' tone-indigo' : ''}">${row.role === 'admin' ? '管理员' : '用户'}</span></td>
                      <td>${row.noteCount}</td>
                      <td>${escapeHtml(formatDate(row.createdAt))}</td>
                      <td class="cell-actions">
                        ${
                          row.id === ctx.user.id
                            ? '<em class="hint">—</em>'
                            : `<button class="btn btn-ghost" type="button" data-action="toggle-role" data-id="${row.id}" data-role="${row.role}">${row.role === 'admin' ? '降为用户' : '设为管理员'}</button>
                               <button class="btn btn-ghost-danger" type="button" data-action="delete-user" data-id="${row.id}">删除</button>`
                        }
                      </td>
                    </tr>`,
                  )
                  .join('')
              : '<tr><td colspan="5" class="cell-empty">暂无用户</td></tr>'
          }
        </tbody>
      </table>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h3>站点</h3></div>
    <dl class="defs">
      <div><dt>名称</dt><dd>${escapeHtml(site.site_name)}</dd></div>
      <div><dt>标语</dt><dd>${escapeHtml(site.site_tagline)}</dd></div>
      <div><dt>注册</dt><dd>${site.allow_registration === 'true' ? '开放' : '已关闭'}</dd></div>
    </dl>
  </section>`;
}

/* --------------------------------- 访客页面 --------------------------------- */

export function landingPage({ site }) {
  return `<section class="hero">
    <p class="hero-eyebrow">Node.js 双端 · 零第三方依赖</p>
    <h1>${escapeHtml(site.site_name)}</h1>
    <p class="hero-text">${escapeHtml(site.site_tagline)}。服务端直接渲染页面，客户端接管交互，一个进程、一个数据库就能跑起来。</p>
    <div class="hero-actions">
      <a class="btn btn-primary btn-lg" href="/register">创建账号</a>
      <a class="btn btn-lg" href="/login">登录</a>
    </div>
  </section>
  <section class="feature-grid">
    ${[
      ['仪表盘', '活跃趋势、待办概览、常用书签与最近动态，一屏掌握全局。'],
      ['笔记', '支持标签、颜色标记与置顶，正文可被全局搜索命中。'],
      ['待办', '优先级、截止日期、分组视图，勾选即写回数据库。'],
      ['书签', '按标签归类、记录点击次数，星标常用站点。'],
      ['文件', '拖拽上传、按目录归档，实时统计存储占用。'],
      ['搜索', '一次检索跨笔记、待办、书签与文件。'],
    ]
      .map(
        ([title, text]) => `<article class="feature">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(text)}</p>
        </article>`,
      )
      .join('')}
  </section>`;
}

export function authPage({ mode, site, values = {}, error = '' }) {
  const isLogin = mode === 'login';
  return `<section class="auth-card">
    <a class="brand brand-center" href="/">
      <span class="brand-mark" aria-hidden="true">H</span>
      <span class="brand-text"><strong>Hub</strong><em>超级中心</em></span>
    </a>
    <h1>${isLogin ? '欢迎回来' : '创建账号'}</h1>
    <p class="auth-sub">${isLogin ? '登录后继续你的工作台' : escapeHtml(site.site_tagline)}</p>
    <div class="toast-host inline" data-inline-host role="status" aria-live="polite"></div>
    <form class="form" data-form="${mode}">
      ${
        isLogin
          ? ''
          : `<label class="field"><span>用户名</span><input class="input" name="username" value="${attr(values.username ?? '')}" required minlength="3" maxlength="24" autocomplete="username"></label>`
      }
      <label class="field"><span>邮箱</span><input class="input" type="email" name="email" value="${attr(values.email ?? '')}" required autocomplete="email"></label>
      <label class="field">
        <span>密码</span>
        <input class="input" type="password" name="password" ${isLogin ? '' : 'minlength="8"'} required autocomplete="${isLogin ? 'current-password' : 'new-password'}" ${
          isLogin ? '' : 'data-password-meter'
        }>
      </label>
      ${
        isLogin
          ? ''
          : `<div class="meter" data-meter hidden><div class="meter-bar"></div><span></span></div>
             <label class="field"><span>确认密码</span><input class="input" type="password" name="confirm" required minlength="8" autocomplete="new-password"></label>`
      }
      <button class="btn btn-primary btn-block" type="submit">${isLogin ? '登录' : '注册并进入'}</button>
    </form>
    ${
      error ? `<p class="form-error">${escapeHtml(error)}</p>` : ''
    }
    <p class="auth-switch">${isLogin ? '还没有账号？' : '已经有账号了？'} <a href="${isLogin ? '/register' : '/login'}">${isLogin ? '立即注册' : '去登录'}</a></p>
  </section>`;
}

export function userPage(ctx) {
  const { profile, stats, notes: recent } = ctx.data;
  return `${pageHead(profile.nickname, `@${profile.username}${profile.bio ? ` · ${profile.bio}` : ''}`, `<a class="btn" href="/notes">看看笔记</a>`)}
  <section class="stat-grid">
    ${statCard({ label: '笔记', value: formatNumber(stats.notes), tone: 'tone-indigo' })}
    ${statCard({ label: '书签', value: formatNumber(stats.links), tone: 'tone-cyan' })}
    ${statCard({ label: '加入于', value: formatDate(profile.createdAt), tone: 'tone-emerald' })}
    ${statCard({ label: '角色', value: profile.role === 'admin' ? '管理员' : '用户', tone: 'tone-amber' })}
  </section>
  <section class="card">
    <div class="card-head"><h3>最近笔记</h3></div>
    ${recent.length ? `<ul class="list">${recent.map(noteRow).join('')}</ul>` : empty('还没有公开笔记', '')}
  </section>`;
}

export function notFoundPage() {
  return `${pageHead('404', '这个页面不存在')}
  ${empty('页面走丢了', '检查一下地址，或者回到仪表盘', '<a class="btn btn-primary" href="/">回到仪表盘</a>')}`;
}

export { pageHead, empty, statCard };
