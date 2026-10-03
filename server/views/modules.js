import { escapeHtml, icon, initials, attr } from './html.js';
import { formatBytes, formatNumber, fromNow, formatDate } from './format.js';
import { pageHead, empty, statCard } from './shared.js';
import { avatar } from './blog.js';
import { avatarWithFrame } from './avatar.js';

const KIND_LABELS = { skin: '主题皮肤', frame: '头像框', title: '称号', badge: '勋章', storage: '存储扩容', consumable: '一次性道具' };
const KIND_ORDER = [
  ['skin', '主题皮肤', '兑换后整站配色立即切换'],
  ['frame', '头像框', '个人中心与主页头像描边'],
  ['title', '称号', '显示在昵称旁'],
  ['badge', '勋章', '收集展示在个人中心'],
  ['storage', '存储扩容', '永久提高文件配额'],
  ['consumable', '一次性道具', '使用后即消耗'],
];
const SHOP_ICON = { skin: 'sun', frame: 'dashboard', title: 'tag', badge: 'admin', storage: 'files', consumable: 'editor' };

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

const ROLE_LABEL = { owner: '群主', admin: '管理员', member: '成员', visitor: '访客' };

export function chatPage(ctx) {
  const user = ctx.user;
  const { rooms, peers, discover, active, messages, members, myRole, pinned, muted = false, oldestId, hasMore } = ctx.data;

  const roomItem = (room, { active: isActive, sub = '', unread = 0 }) =>
    `<button class="room-item${isActive ? ' is-active' : ''}" type="button" data-action="switch-room" data-room="${attr(room.code)}">
      <span class="room-avatar room-${room.type}" style="--hue:${Number(room.avatarHue) || 210}">${
        room.type === 'dm' ? escapeHtml(initials(room.peer?.nickname)) : escapeHtml(initials(room.name))
      }</span>
      <span class="room-text">
        <strong>${escapeHtml(room.type === 'dm' ? (room.peer?.nickname ?? room.name) : room.name)}</strong>
        <em>${escapeHtml(sub || (room.topic || (room.type === 'dm' ? '私聊' : `${room.memberCount} 人`)))}</em>
      </span>
      ${unread ? `<em class="room-unread">${unread > 99 ? '99+' : unread}</em>` : ''}
    </button>`;

  return `${pageHead('聊天室', `${rooms.groups.length} 个群 · ${rooms.dms.length} 个会话 · 消息实时同步`)}
  <div class="chat-layout">
    <aside class="chat-rooms card">
      <div class="chat-rooms-head">
        <h3>我的会话</h3>
        <div class="row-actions">
          <button class="icon-btn" type="button" data-action="new-dm" title="发起私聊" aria-label="发起私聊">✉</button>
          <button class="icon-btn" type="button" data-action="new-room" title="创建群聊" aria-label="创建群聊">＋</button>
        </div>
      </div>
      <div class="room-list" data-room-list>
        ${roomItem({ code: 'lobby', name: '公共大厅', type: 'lobby', avatarHue: 210, memberCount: 0 }, { active: active.code === 'lobby', sub: '所有人可见' })}
        ${rooms.dms.map((room) => roomItem(room, { active: active.code === room.code, sub: room.lastMessage?.body ?? '还没有消息', unread: room.unread })).join('')}
        ${rooms.groups.map((room) => roomItem(room, { active: active.code === room.code, unread: room.unread })).join('')}
        ${rooms.groups.length && rooms.dms.length ? '<hr class="room-divider">' : ''}
        <details class="discover">
          <summary>公开群（${discover.length}）</summary>
          <div class="discover-list">
            ${
              discover.length
                ? discover
                    .map(
                      (room) => `<div class="discover-item">
                        <span class="room-avatar room-group" style="--hue:${Number(room.avatarHue) || 210}">${escapeHtml(initials(room.name))}</span>
                        <span class="room-text"><strong>${escapeHtml(room.name)}</strong><em>${escapeHtml(room.topic || `${room.memberCount} 人`)}</em></span>
                        ${
                          room.joined
                            ? '<span class="badge tone-emerald">已加入</span>'
                            : `<button class="btn btn-ghost" type="button" data-action="join-room" data-room="${attr(room.code)}">加入</button>`
                        }
                      </div>`,
                    )
                    .join('')
                : '<p class="hint">暂时没有公开群</p>'
            }
          </div>
        </details>
      </div>
    </aside>

    <section class="chat-main card" data-chat-room="${attr(active.code)}">
      <header class="chat-head">
        <div>
          <h3>${escapeHtml(active.type === 'dm' ? (active.peer?.nickname ?? active.name) : active.name)}</h3>
          <p class="hint" data-room-sub>${escapeHtml(active.topic || (active.type === 'dm' ? '私聊会话' : `${active.memberCount} 位成员`))}</p>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost" type="button" data-action="open-search" title="搜索本房间消息">搜索</button>
          ${
            user && active.code !== 'lobby'
              ? `<button class="btn btn-ghost${muted ? ' is-on' : ''}" type="button" data-action="toggle-mute" data-room="${attr(active.code)}" title="${muted ? '取消免打扰' : '免打扰'}">${muted ? '🔕' : '🔔'}</button>
                 <button class="btn btn-ghost" type="button" data-action="invite-member" data-room="${attr(active.code)}"${myRole === 'member' && user.id !== active.ownerId ? ' disabled title="仅成员及以上可拉人"' : ''}>拉人</button>
                 ${myRole === 'owner' ? `<button class="btn btn-ghost" type="button" data-action="room-settings" data-room="${attr(active.code)}">设置</button>` : ''}
                 ${myRole === 'member' ? `<button class="btn btn-ghost" type="button" data-action="leave-room" data-room="${attr(active.code)}">退群</button>` : ''}
                 ${myRole === 'owner' ? `<button class="btn btn-ghost-danger" type="button" data-action="delete-room" data-room="${attr(active.code)}">解散</button>` : ''}`
              : ''
          }
          ${active.code === 'lobby' ? '' : `<button class="btn btn-ghost" type="button" data-action="toggle-members">成员 ${members.length}</button>`}
        </div>
      </header>

      ${
        pinned
          ? `<div class="chat-pinned" data-pinned-bar>
              <span class="chat-pinned-label">📌 群公告</span>
              <p class="chat-pinned-text">${escapeHtml((pinned.quote?.body || pinned.body || '').slice(0, 160))}</p>
              <span class="chat-pinned-who">${escapeHtml(pinned.nickname)}</span>
              ${user && myRole ? `<button class="icon-btn" type="button" data-action="unpin" data-room="${attr(active.code)}" title="取消置顶" aria-label="取消置顶">✕</button>` : ''}
            </div>`
          : ''
      }

      <form class="chat-search" data-chat-search hidden>
        <input class="input" type="search" name="q" placeholder="在本房间搜索消息…" autocomplete="off" data-chat-search-input>
        <button class="btn" type="button" data-action="close-search">关闭</button>
      </form>
      <div class="chat-search-results" data-chat-search-results hidden></div>

      <div class="chat-log" id="chat-log" data-room="${attr(active.code)}" data-nick="${attr(user?.nickname ?? '访客')}" data-auth="${user ? 1 : 0}" data-oldest="${oldestId ?? ''}">
        <div class="chat-load" data-load-more ${hasMore ? '' : ' hidden'}>
          <button class="btn btn-ghost" type="button" data-action="load-older">加载更早的消息</button>
        </div>
        ${
          messages.length
            ? withDateDividers(messages, user?.id, active.code).join('')
            : '<p class="hint chat-hint">还没有消息，说点什么吧。</p>'
        }
      </div>

      ${
        user
          ? `<form class="chat-reply-bar" data-reply-bar hidden>
              <div class="chat-reply-hint">
                <span>回复 <strong data-reply-nick></strong></span>
                <button class="icon-btn" type="button" data-action="cancel-reply" aria-label="取消回复">✕</button>
              </div>
              <div class="chat-reply-fields">
                <input class="input" name="replyTo" type="hidden">
                <input class="input" name="body" placeholder="回复…" maxlength="500" autocomplete="off">
                <button class="btn btn-primary" type="submit">回复</button>
              </div>
            </form>`
          : ''
      }

      ${
        user
          ? `<form class="chat-input" data-chat-form>
              <button class="icon-btn" type="button" data-action="send-file" title="发送文件" aria-label="发送文件">📎</button>
              <input class="input" name="body" placeholder="说点什么…（Enter 发送，/help 看指令）" maxlength="500" autocomplete="off">
              <button class="btn btn-primary" type="submit">发送</button>
            </form>
             <p class="hint chat-status" data-chat-status>连接中…</p>`
          : `<p class="hint chat-status">游客只能浏览，<a href="/login?next=%2Fchat">登录</a>后即可发言。</p>`
      }
    </section>

    <aside class="chat-members card${active.code === 'lobby' ? ' is-hidden' : ''}" data-members-panel>
      <div class="chat-rooms-head"><h3>成员</h3><span class="badge">${members.length}</span></div>
      <ul class="list member-list" data-member-list>
        ${
          members.length
            ? members
                .map(
                  (member) => `<li class="row" data-member="${member.id}">
                    ${avatarWithFrame(member, 'avatar avatar-sm')}
                    <span class="row-main">
                      <span class="row-title">${escapeHtml(member.nickname)}${member.title ? ` <em class="badge">${escapeHtml(member.title)}</em>` : ''}</span>
                      <span class="row-meta">@${escapeHtml(member.username)} · ${escapeHtml(ROLE_LABEL[member.role] ?? member.role)}</span>
                    </span>
                    ${
                      myRole && ['owner', 'admin'].includes(myRole) && member.role !== 'owner' && member.id !== user?.id
                        ? `<button class="icon-btn" type="button" data-action="kick-member" data-room="${attr(active.code)}" data-id="${member.id}" title="移出">✕</button>`
                        : ''
                    }
                  </li>`,
                )
                .join('')
            : '<li class="row"><span class="row-main"><span class="row-meta">—</span></span></li>'
        }
      </ul>
    </aside>
  </div>`;
}

const chatBubble = (message, myId, roomCode) => {
  if (message.kind === 'system') return `<p class="chat-system" data-id="${message.id}">${escapeHtml(message.body)}</p>`;
  if (message.kind === 'action') {
    return `<p class="chat-action" data-id="${message.id}"><strong>${escapeHtml(message.nickname)}</strong> ${escapeHtml(message.body)}</p>`;
  }

  const mine = myId && message.userId === myId;
  const canPin = roomCode !== 'lobby';
  const stamp = formatDate(message.createdAt, true);
  const readCount = (message.reads?.length ?? 0);

  return `<div class="chat-row${mine ? ' is-mine' : ''}" id="msg-${message.id}" data-id="${message.id}">
    <span class="avatar avatar-sm chat-avatar" style="--hue:${(message.nickname || '').length * 37 % 360}">${escapeHtml(initials(message.nickname))}</span>
    <div class="chat-bubble-wrap">
      <span class="chat-nick">${escapeHtml(message.nickname)}</span>
      ${
        message.quote
          ? `<a class="chat-quote" href="#msg-${message.quote.id}" data-jump="${message.quote.id}">
              <strong>${escapeHtml(message.quote.nickname)}</strong>
              <em>${escapeHtml(message.quote.body)}</em>
            </a>`
          : ''
      }
      ${
        message.attachment
          ? `<a class="chat-file" href="${attr(message.attachment.url)}" data-file-id="${message.attachment.id}" download>
              <span class="chat-file-icon">${escapeHtml((message.attachment.name.split('.').pop() ?? 'file').slice(0, 4).toUpperCase())}</span>
              <span class="chat-file-text">
                <strong>${escapeHtml(message.attachment.name)}</strong>
                <em>${formatBytes(message.attachment.size)} · ${message.attachment.downloads} 次下载</em>
              </span>
              <span class="chat-file-dl">↓</span>
            </a>`
          : `<div class="chat-bubble">${escapeHtml(message.body)}</div>`
      }
    </div>
    <span class="chat-meta">
      <time class="chat-time" title="${escapeHtml(stamp)}">${escapeHtml(fromNow(message.createdAt))}</time>
      ${readCount > 1 ? `<em class="chat-reads" title="已被 ${readCount} 人读过">${readCount} 已读</em>` : ''}
    </span>
    <span class="chat-hover">
      <button class="icon-btn" type="button" data-action="reply-to" data-id="${message.id}" data-nick="${attr(message.nickname)}" data-body="${attr(String(message.body || '').slice(0, 60))}" title="回复" aria-label="回复">↩</button>
      ${
        canPin
          ? `<button class="icon-btn" type="button" data-action="pin-message" data-room="${attr(roomCode)}" data-id="${message.id}" title="置顶为群公告" aria-label="置顶">📌</button>`
          : ''
      }
    </span>
  </div>`;
};

/** 在消息之间插入日期分隔线（跨天才插）。 */
function withDateDividers(messages, myId, roomCode) {
  const out = [];
  let lastDay = '';
  for (const message of messages) {
    const day = String(message.createdAt ?? '').slice(0, 10);
    if (day !== lastDay) {
      out.push(`<div class="chat-daysep"><span>${escapeHtml(dayDividerLabel(day))}</span></div>`);
      lastDay = day;
    }
    out.push(chatBubble(message, myId, roomCode));
  }
  return out;
}

function dayDividerLabel(day) {
  if (!day) return '';
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (day === today) return '今天';
  if (day === yesterday) return '昨天';
  return day;
}

const el_time = (value) => formatDate(value, true);

/* -------------------------------- 积分中心 -------------------------------- */

export function pointsPage(ctx) {
  const { overview, logs, leaderboard, items, mine, rank } = ctx.data;
  const user = ctx.user;
  const today = overview.calendar.find((day) => day.isToday);
  // 皮肤/框/称号是唯一类，只有「当前生效」的那件算使用中
  const activePayload = { skin: overview.skin ?? '', frame: overview.frame ?? '', title: overview.title ?? '' };
  const equippedSkus = new Set(
    mine.filter((item) => !item.used && ['skin', 'frame', 'title'].includes(item.kind) && item.payload === activePayload[item.kind]).map((item) => item.sku),
  );
  const ownedSkus = new Set(mine.map((item) => item.sku));

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
                  ${avatarWithFrame({ nickname: row.nickname, avatarHue: row.avatarHue, frame: row.frame }, 'avatar avatar-sm')}
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
    <div class="card-head"><h3>积分商城</h3><span class="badge">余额 ${formatNumber(overview.balance)} · 共 ${items.length} 件</span></div>
    <div class="shop-groups">
      ${KIND_ORDER.map(([kind, label, hint]) => {
        const group = items.filter((item) => item.kind === kind);
        if (!group.length) return '';
        return `<div>
          <h4 class="shop-group-title">${escapeHtml(label)}<span class="hint">${escapeHtml(hint)}</span></h4>
          <div class="shop-grid">
            ${group
              .map((item) => {
                const affordable = !item.soldOut && overview.balance >= item.cost;
                const equipped = equippedSkus.has(item.sku);
                return `<article class="shop-card${equipped ? ' is-equipped' : ''}">
                  <div class="shop-mark shop-${item.kind}">${icon(SHOP_ICON[item.kind] ?? 'points', 20)}</div>
                  <div class="shop-body">
                    <strong>${escapeHtml(item.name)}${equipped ? ' <em class="badge tone-emerald">使用中</em>' : ''}</strong>
                    <p>${escapeHtml(item.description)}</p>
                    <div class="shop-foot">
                      ${item.stock !== null ? `<span class="hint">库存 ${Math.max(0, item.stock - item.sold)}</span>` : '<span class="hint">不限量</span>'}
                      <span class="shop-cost">${item.cost ? `${formatNumber(item.cost)} 分` : '免费'}</span>
                    </div>
                  </div>
                  ${
                    equipped
                      ? '<button class="btn" type="button" disabled>已装备</button>'
                      : item.cost === 0 && !ownedSkus.has(item.sku)
                        ? `<button class="btn" type="button" data-action="redeem" data-id="${item.id}">领取</button>`
                        : `<button class="btn${affordable ? ' btn-primary' : ''}" type="button" data-action="redeem" data-id="${item.id}"${affordable ? '' : ' disabled'}>
                            ${item.soldOut ? '已售罄' : affordable ? (ownedSkus.has(item.sku) ? '切换' : '兑换') : `还差 ${formatNumber(item.cost - overview.balance)} 分`}
                          </button>`
                  }
                </article>`;
              })
              .join('')}
          </div>
        </div>`;
      }).join('')}
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
