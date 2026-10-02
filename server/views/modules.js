import { escapeHtml, icon, initials, attr } from './html.js';
import { formatBytes, formatNumber, fromNow, formatDate } from './format.js';
import { pageHead, empty, statCard } from './shared.js';
import { avatar } from './blog.js';

const KIND_LABELS = { skin: '主题皮肤', frame: '头像框', badge: '勋章', storage: '存储扩容', consumable: '一次性道具' };

/* --------------------------------- 短链 --------------------------------- */

export function shortsPage(ctx) {
  const { items, stats } = ctx.data;
  return `${pageHead('短链', `${stats.total} 条 · ${stats.active} 条启用 · 累计点击 ${formatNumber(stats.clicks)} 次`, `<button class="btn btn-primary" type="button" data-action="new-short">${icon('plus', 16)}创建短链</button>`)}
  <div class="stat-grid">
    ${statCard({ label: '短链总数', value: formatNumber(stats.total), tone: 'tone-indigo' })}
    ${statCard({ label: '启用中', value: formatNumber(stats.active), tone: 'tone-emerald' })}
    ${statCard({ label: '累计点击', value: formatNumber(stats.clicks), tone: 'tone-cyan' })}
    ${statCard({ label: '平均点击', value: stats.total ? Math.round(stats.clicks / stats.total) : 0, hint: '次 / 条', tone: 'tone-amber' })}
  </div>
  ${
    items.length
      ? `<div class="card"><div class="table-wrap"><table class="table">
          <thead><tr><th>短链</th><th>目标</th><th>备注</th><th>点击</th><th>状态</th><th></th></tr></thead>
          <tbody>${items
            .map(
              (short) => `<tr>
                <td><a class="short-code" href="/s/${attr(short.code)}" target="_blank" rel="noopener">/s/${escapeHtml(short.code)}</a></td>
                <td><span class="short-target" title="${attr(short.targetUrl)}">${escapeHtml(hostOf(short.targetUrl))}</span></td>
                <td>${escapeHtml(short.title || '—')}</td>
                <td>${formatNumber(short.clicks)}</td>
                <td><span class="badge${short.active ? ' tone-emerald' : ''}">${short.active ? '启用' : '停用'}</span></td>
                <td class="cell-actions">
                  <button class="btn btn-ghost" type="button" data-action="copy-short" data-code="${attr(short.code)}">复制</button>
                  <button class="btn btn-ghost" type="button" data-action="toggle-short" data-id="${short.id}" data-active="${short.active ? 1 : 0}">${short.active ? '停用' : '启用'}</button>
                  <button class="btn btn-ghost-danger" type="button" data-action="delete-short" data-id="${short.id}">删除</button>
                </td>
              </tr>`,
            )
            .join('')}</tbody></table></div></div>`
      : empty('还没有短链', '把长链接缩短成 /s/xxxxx，带点击统计', '', 'links')
  }`;
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return String(url).slice(0, 40);
  }
};

/* -------------------------------- 聊天室 -------------------------------- */

export function chatPage(ctx) {
  const { messages, online, me } = ctx.data;
  const user = ctx.user;
  return `${pageHead('聊天室', '房间「大厅」· 消息实时同步，支持 /help /who /time /me 指令', '')}
  <div class="chat card">
    <div class="chat-main">
      <div class="chat-log" id="chat-log" data-room="lobby" data-nick="${attr(me)}" data-auth="${user ? 1 : 0}">
        ${
          messages.length
            ? messages.map((message) => chatBubble(message, user?.id)).join('')
            : '<p class="hint chat-hint">还没有消息，说点什么吧。</p>'
        }
      </div>
      <form class="chat-input" data-chat-form>
        <input class="input" name="body" placeholder="说点什么…（Enter 发送，/help 看指令）" maxlength="500" autocomplete="off">
        <button class="btn btn-primary" type="submit">发送</button>
      </form>
      <p class="hint chat-status" data-chat-status>${user ? `以 ${escapeHtml(user.nickname)} 身份在线` : '游客模式，登录后可显示昵称'}</p>
    </div>
    <aside class="chat-side">
      <div class="card">
        <div class="card-head"><h3>在线成员</h3><span class="badge" data-online-count>${online}</span></div>
        <ul class="list" data-online-list><li class="row"><span class="row-main"><span class="row-meta">等待连接…</span></span></li></ul>
      </div>
      <div class="card">
        <div class="card-head"><h3>可用指令</h3></div>
        <ul class="defs">
          <div><dt><code>/help</code></dt><dd>帮助</dd></div>
          <div><dt><code>/who</code></dt><dd>在线人数</dd></div>
          <div><dt><code>/time</code></dt><dd>服务器时间</dd></div>
          <div><dt><code>/me 微笑</code></dt><dd>动作</dd></div>
        </ul>
      </div>
    </aside>
  </div>`;
}

const chatBubble = (message, myId) => {
  const mine = myId && message.userId === myId;
  if (message.kind === 'system') return `<p class="chat-system">${escapeHtml(message.body)}</p>`;
  if (message.kind === 'action') return `<p class="chat-action"><strong>${escapeHtml(message.nickname)}</strong> ${escapeHtml(message.body)}</p>`;
  return `<div class="chat-row${mine ? ' is-mine' : ''}" data-id="${message.id}">
    <span class="avatar avatar-sm chat-avatar" style="--hue:${(message.nickname || '').length * 37 % 360}">${escapeHtml(initials(message.nickname))}</span>
    <div class="chat-bubble-wrap">
      <span class="chat-nick">${escapeHtml(message.nickname)}</span>
      <div class="chat-bubble">${escapeHtml(message.body)}</div>
    </div>
    <time class="chat-time">${escapeHtml(fromNow(message.createdAt))}</time>
  </div>`;
};

/* -------------------------------- 积分中心 -------------------------------- */

export function pointsPage(ctx) {
  const { overview, logs, leaderboard, items, mine, rank } = ctx.data;
  const user = ctx.user;
  const today = overview.calendar.find((day) => day.isToday);

  return `${pageHead('积分中心', `余额 ${formatNumber(overview.balance)} · 累计赚取 ${formatNumber(overview.earned)} · 排名第 ${rank ?? '—'} 位`,
    `<div class="row-actions">
       <button class="btn btn-primary" type="button" data-action="checkin"${overview.checkedToday ? ' disabled' : ''}>
         ${overview.checkedToday ? '今日已签到' : '每日签到 +5'}
       </button>
     </div>`)}

  <section class="stat-grid">
    ${statCard({ label: '可用积分', value: formatNumber(overview.balance), hint: `今日签到 +${overview.streak >= 3 ? 10 : 5}`, tone: 'tone-indigo' })}
    ${statCard({ label: '连续签到', value: `${overview.streak} 天`, hint: overview.streak >= 3 ? '连签奖励生效中' : '连签 3 天起额外 +5', tone: 'tone-emerald' })}
    ${statCard({ label: '累计赚取', value: formatNumber(overview.earned), hint: `消费 ${formatNumber(overview.totals.spent)}`, tone: 'tone-cyan' })}
    ${statCard({ label: '排行榜名次', value: rank ? `第 ${rank}` : '未上榜', hint: '签到与创作可提升排名', tone: 'tone-amber' })}
  </section>

  <div class="split">
    <section class="card">
      <div class="card-head"><h3>签到日历</h3><span class="badge">近 28 天</span></div>
      <div class="calendar">
        ${overview.calendar
          .map(
            (day) => `<span class="cal-cell${day.checked ? ' is-on' : ''}${day.isToday ? ' is-today' : ''}" title="${day.day}${day.checked ? ` · +${day.reward}` : ''}">${Number(day.day.slice(-2))}</span>`,
          )
          .join('')}
      </div>
      ${today ? `<p class="hint">${overview.checkedToday ? `今天已签到，奖励 +${today.reward} 积分。` : '今天还没签到，点右上角领取奖励。'}</p>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><h3>积分排行榜</h3></div>
      ${
        leaderboard.length
          ? `<ol class="rank-list">${leaderboard
              .map(
                (row) => `<li${row.id === user.id ? ' class="is-me"' : ''}>
                  <span class="rank-no rank-${row.rank}">${row.rank}</span>
                  ${avatar(row.nickname, row.avatarHue, 'sm')}
                  <span class="rank-body">
                    <a href="/u/${attr(row.username)}">${escapeHtml(row.nickname)}</a>
                    <span class="row-meta">${formatNumber(row.posts)} 篇文章</span>
                  </span>
                  <strong class="rank-points">${formatNumber(row.points)}</strong>
                </li>`,
              )
              .join('')}</ol>`
          : empty('排行榜还是空的', '签到或发布文章即可上榜')
      }
    </section>
  </div>

  <section class="card">
    <div class="card-head"><h3>积分商城</h3><span class="badge">余额 ${formatNumber(overview.balance)}</span></div>
    <div class="shop-grid">
      ${items
        .map(
          (item) => {
            const affordable = !item.soldOut && overview.balance >= item.cost;
            return `<article class="shop-card">
            <div class="shop-mark shop-${item.kind}">${icon(item.kind === 'skin' ? 'sun' : item.kind === 'storage' ? 'files' : item.kind === 'frame' ? 'dashboard' : 'admin', 20)}</div>
            <div class="shop-body">
              <strong>${escapeHtml(item.name)}</strong>
              <p>${escapeHtml(item.description)}</p>
              <div class="shop-foot">
                <em class="badge">${escapeHtml(KIND_LABELS[item.kind] ?? item.kind)}</em>
                ${item.stock !== null ? `<span class="hint">库存 ${Math.max(0, item.stock - item.sold)}</span>` : '<span class="hint">不限量</span>'}
                <span class="shop-cost">${formatNumber(item.cost)} 分</span>
              </div>
            </div>
            <button class="btn${affordable ? ' btn-primary' : ''}" type="button" data-action="redeem" data-id="${item.id}"${affordable ? '' : ' disabled'}>
              ${item.soldOut ? '已售罄' : affordable ? (item.owned ? '再兑换' : '兑换') : `还差 ${formatNumber(item.cost - overview.balance)} 分`}
            </button>
          </article>`;
          })
        .join('')}
    </div>
  </section>

  <div class="split">
    <section class="card">
      <div class="card-head"><h3>积分流水</h3></div>
      ${
        logs.items.length
          ? `<div class="table-wrap"><table class="table">
              <thead><tr><th>变动</th><th>事由</th><th>余额</th><th>时间</th></tr></thead>
              <tbody>${logs.items
                .map(
                  (log) => `<tr>
                    <td><strong class="${log.delta > 0 ? 'gain' : 'loss'}">${log.delta > 0 ? '+' : ''}${log.delta}</strong></td>
                    <td>${escapeHtml(log.reason)}</td>
                    <td>${formatNumber(log.balance)}</td>
                    <td>${escapeHtml(formatDate(log.createdAt, true))}</td>
                  </tr>`,
                )
                .join('')}</tbody></table></div>`
          : empty('还没有积分记录', '')
      }
    </section>

    <section class="card">
      <div class="card-head"><h3>我的道具</h3><span class="badge">${mine.length}</span></div>
      ${
        mine.length
          ? `<ul class="list">${mine
              .map(
                (item) => `<li class="row">
                  <span class="row-main">
                    <span class="row-title">${escapeHtml(item.name)}</span>
                    <span class="row-meta">${escapeHtml(KIND_LABELS[item.kind] ?? item.kind)} · ${escapeHtml(formatDate(item.acquiredAt))}${item.used ? ' · 已使用' : ''}</span>
                  </span>
                  ${
                    item.kind === 'consumable' && !item.used
                      ? `<button class="btn btn-ghost" type="button" data-action="use-item" data-id="${item.ownedId}">使用</button>`
                      : `<span class="badge">${item.kind === 'skin' ? '已装备' : ''}</span>`
                  }
                </li>`,
              )
              .join('')}</ul>`
          : empty('还没有道具', '去商城兑换一些吧')
      }
    </section>
  </div>

  <section class="card">
    <div class="card-head"><h3>怎么赚积分</h3></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>行为</th><th>积分</th><th>每日上限</th></tr></thead>
      <tbody>${overview.rules
        .map(
          (rule) => `<tr>
            <td>${escapeHtml(rule.label)}</td>
            <td><strong class="gain">+${rule.points}</strong></td>
            <td>${rule.daily === 1 ? '仅一次' : `${rule.daily} 次/天`}</td>
          </tr>`,
        )
        .join('')}</tbody></table></div>
  </section>`;
}

/* ------------------------------ 公开文件分享 ------------------------------ */

export function sharePage(ctx) {
  const { file, owner } = ctx.data;
  return `<div class="share-wrap">
    <div class="card share-card">
      <div class="share-icon">${icon('files', 26)}</div>
      <h1>${escapeHtml(file.name)}</h1>
      <p class="row-meta">${formatBytes(file.size)} · ${escapeHtml(file.mime)} · 由 ${escapeHtml(owner.nickname)} 分享</p>
      <div class="share-actions">
        <a class="btn btn-primary btn-lg" href="/d/${file.id}" download>下载文件</a>
        <button class="btn btn-lg" type="button" data-action="copy-link">复制链接</button>
      </div>
      <p class="hint">${formatNumber(file.downloads)} 次下载</p>
    </div>
  </div>`;
}
