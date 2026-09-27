import { el, clear } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { ChatClient, loadDraft, saveDraft, clearDrafts } from '../lib/chat-client.js';
import { clock, dateShort } from '../lib/format.js';
import { avatar, avatarFramed, empty } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';

const MAX_RENDER = 400;
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const QUICK_EMOJI = ['👍', '❤️', '😂', '🎉', '🚀', '👀', '🙏', '🤔'];

let activeClient = null;

/* ================= 消息文本渲染 ================= */

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;

/**
 * 轻量渲染：转义后只放开行内代码、@提及、链接与换行。
 * 全程走 textContent / 显式建节点，不用 innerHTML，避免 XSS。
 */
function renderBody(target, text, { mentionable = [] } = {}) {
  const src = String(text ?? '');
  const parts = src.split(/(`[^`\n]+`)/g);
  parts.forEach((part) => {
    if (!part) return;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      target.append(el('code.msg-code', {}, part.slice(1, -1)));
      return;
    }
    // 逐段再按链接切分
    let last = 0;
    for (const m of part.matchAll(URL_RE)) {
      if (m.index > last) appendPlain(target, part.slice(last, m.index), mentionable);
      const href = m[0];
      target.append(
        el('a.msg-link', { href, target: '_blank', rel: 'noopener noreferrer nofollow' }, [
          href.length > 48 ? `${href.slice(0, 48)}…` : href,
        ]),
      );
      last = m.index + href.length;
    }
    if (last < part.length) appendPlain(target, part.slice(last), mentionable);
  });
}

function appendPlain(target, text, mentionable) {
  if (!text) return;
  // @提及：命中在线/房间内昵称时高亮
  const re = /@([^\s@]{1,20})/g;
  let last = 0;
  let matched = false;
  for (const m of text.matchAll(re)) {
    const name = m[1];
    if (mentionable.length && !mentionable.includes(name)) continue;
    matched = true;
    if (m.index > last) target.append(document.createTextNode(text.slice(last, m.index)));
    target.append(el('span.msg-mention', { title: `提及 ${name}` }, `@${name}`));
    last = m.index + m[0].length;
  }
  if (!matched) {
    target.append(document.createTextNode(text));
    return;
  }
  if (last < text.length) target.append(document.createTextNode(text.slice(last)));
}

const dayKey = (iso) => new Date(iso).toDateString();

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return '今天';
  if (d.toDateString() === yest.toDateString()) return '昨天';
  return dateShort(iso);
}

/* ================= 视图 ================= */

export default async function chatView(host, ctx = {}) {
  activeClient?.close();
  activeClient = null;

  const state = {
    room: 'lobby',
    rooms: [],
    messages: [],
    online: [],
    onlineTotal: 0,
    typing: [],
    hasMore: false,
    cursor: null,
    replyTo: null,
    editing: null,
    unread: 0,
    filter: '',
    status: 'connecting',
    atBottom: true,
    loadingOlder: false,
  };

  /* ---------- DOM ---------- */

  const log = el('div.chat-log', {
    role: 'log',
    'aria-live': 'polite',
    'aria-label': '聊天消息',
    tabindex: '0',
  });
  const statusDot = el('span.online-dot');
  const statusText = el('span.small.muted', {}, '连接中…');
  const onlineText = el('span.small.muted', {}, '');
  const typingLine = el('div.chat-typing', { 'aria-live': 'polite' });
  const topBar = el('div.chat-topbar');
  const jumpBtn = el('button.chat-jump', { type: 'button', title: '回到最新', hidden: true }, [
    el('span.chat-jump-badge', { hidden: true }, '0'),
    el('span', {}, '↓ 最新消息'),
  ]);

  const roomList = el('div.chat-rooms', { role: 'tablist', 'aria-label': '房间列表' });
  const peopleList = el('div.chat-people', { 'aria-label': '在线成员' });
  const searchInput = el('input.input.input-sm', {
    type: 'search',
    placeholder: '搜索聊天记录',
    'aria-label': '搜索聊天记录',
  });

  const nickInput = el('input.input.input-sm.nick-input', {
    placeholder: '你的昵称',
    maxlength: '20',
    'aria-label': '昵称',
    value: localStorage.getItem('hub.nick') || store.user?.nickname || '',
  });
  const composer = el('textarea.chat-composer', {
    rows: '1',
    placeholder: '说点什么…（Enter 发送 · Shift+Enter 换行）',
    'aria-label': '消息输入',
    maxlength: '2000',
  });
  const charCount = el('span.chat-count', {}, '0/2000');
  const sendBtn = el('button.btn.btn-primary.chat-send', { type: 'button' }, '发送');
  const replyBar = el('div.chat-replybar', { hidden: true });
  const emojiPanel = el('div.chat-emoji', { hidden: true, role: 'listbox' });
  const mentionPanel = el('div.chat-mention', { hidden: true, role: 'listbox' });
  const commandPanel = el('div.chat-commands', { hidden: true, role: 'listbox' });

  const shell = el('div.chat-shell', {}, [
    topBar,
    el('div.chat-main', {}, [
      el('div.chat-side.chat-side-left', {}, [
        el('div.chat-side-title', {}, ['房间', roomList]),
        el('div.chat-side-title', {}, ['成员', peopleList]),
      ]),
      el('div.chat-stream', {}, [
        el('div.chat-log-wrap', {}, [log, jumpBtn, emojiPanel, mentionPanel, commandPanel]),
        typingLine,
        el('div.chat-composer-wrap', {}, [replyBar, el('div.chat-input', {}, [nickInput, composer, sendBtn]), charCount]),
      ]),
      el('div.chat-side.chat-side-right', {}, [
        el('div.chat-side-title', {}, ['房间信息', el('div.chat-roominfo', {})]),
        el('div.chat-side-title', {}, ['快捷表情', el('div.chat-quick', {}, QUICK_EMOJI.map((e) => el('button.chat-quick-btn', { type: 'button', title: `插入 ${e}` }, e)))]),
        el('div.chat-side-title', {}, [el('span', {}, '消息检索'), searchInput, el('div.chat-results', {})]),
      ]),
    ]),
  ]);

  // 整页纵向 flex：标题自适应高度，卡片吃掉剩余空间（见 chat.css 的 .chat-page）
  host.append(
    el('div.chat-page', {}, [
      el('div.page-head', {}, [
        el('h1', {}, '实时聊天室'),
        el('p', {}, '服务端手写 WebSocket（RFC 6455），多房间 · 输入中提示 · 表情回应 · 引用回复 · 断线重连与离线补发。'),
      ]),
      el('div.card.chat-card', { style: { padding: '0', overflow: 'hidden' } }, shell),
    ]),
  );

  const roomInfoBox = shell.querySelector('.chat-roominfo');
  const resultsBox = shell.querySelector('.chat-results');
  const quickBox = shell.querySelector('.chat-quick');

  /* ---------- 客户端 ---------- */

  const client = new ChatClient({
    room: ctx.query?.room || 'lobby',
    nick: localStorage.getItem('hub.nick') || '',
  });
  activeClient = client;

  client.on('status', ({ status, retry }) => {
    state.status = status;
    statusDot.className = `online-dot${status === 'online' ? '' : ' off'}`;
    const label = {
      online: '已连接',
      connecting: '连接中…',
      reconnecting: '重连中…',
      offline: '已断开',
      error: '连接失败',
      closed: '已离开',
    }[status];
    statusText.textContent = status === 'reconnecting' ? `${label}（第 ${retry} 次）` : label;
    composer.disabled = status === 'closed';
    sendBtn.disabled = status === 'closed' || !!client.muted;
    if (status === 'online') updateOnlineBadge();
  });

  client.on('ready', (payload) => {
    state.rooms = payload.rooms || [];
    state.online = payload.onlineList || [];
    state.onlineTotal = payload.onlineTotal || 0;
    state.mutedFromServer = payload.muted || null;
    if (client.muted) toast.warning('你已被禁言，只能浏览');
    state.messages = (payload.messages?.items || []).map((m) => ({ ...m, pending: false }));
    state.hasMore = !!payload.messages?.hasMore;
    state.cursor = payload.messages?.cursor || null;
    state.room = payload.room || state.room;
    renderAll();
    if (!store.user && !localStorage.getItem('hub.nick')) {
      toast.info('设置一个昵称即可参与聊天');
    }
    markRead();
  });

  client.on('joined', (payload) => {
    state.room = payload.room;
    state.rooms = payload.rooms || state.rooms;
    state.online = payload.onlineList || [];
    state.messages = (payload.messages?.items || []).map((m) => ({ ...m, pending: false }));
    state.hasMore = !!payload.messages?.hasMore;
    state.cursor = payload.messages?.cursor || null;
    state.unread = 0;
    state.replyTo = null;
    state.editing = null;
    composer.value = loadDraft(state.room);
    renderReplyBar();
    renderAll();
    history.replaceState(null, '', `#/chat?room=${encodeURIComponent(state.room)}`);
    markRead();
  });

  client.on('rooms', ({ rooms }) => {
    state.rooms = rooms;
    renderRooms();
  });

  client.on('message', ({ message, room, clientId }) => {
    if (room !== state.room) {
      bumpUnread(room);
      return;
    }
    const optimistic = clientId ? state.messages.find((m) => m.clientId === clientId && m.pending) : null;
    if (optimistic) {
      settleMessage(optimistic, message);
    } else if (!state.messages.some((m) => m.id === message.id)) {
      state.messages.push(message);
      if (state.messages.length > MAX_RENDER) state.messages.splice(0, state.messages.length - MAX_RENDER);
      appendNode(message, { animate: true });
    }
    pruneDom();
    scrollIfPinned(message.isMe);
    maybeNotify(message);
  });

  // 乐观消息失败：标红并允许重发
  client.on('reject', ({ clientId, payload }) => {
    const node = log.querySelector(`[data-client="${cssEscape(clientId)}"]`);
    if (node) {
      node.classList.add('failed');
      node.title = payload.message || '发送失败';
    }
    const idx = state.messages.findIndex((m) => m.clientId === clientId);
    if (idx >= 0) state.messages[idx].failed = payload.message;
    if (payload.code === 'muted') {
      toast.error(payload.message);
      client.muted = { permanent: true };
      sendBtn.disabled = true;
    } else if (payload.code === 'rate_limited') {
      toast.warning(payload.message);
    } else if (payload.code !== 'too_long' && payload.code !== 'empty') {
      toast.error(payload.message);
    }
  });

  client.on('settle', ({ clientId, message }) => {
    const optimistic = state.messages.find((m) => m.clientId === clientId);
    if (optimistic) settleMessage(optimistic, message);
  });

  client.on('error', (payload) => {
    if (payload.clientId) return; // 已由 reject 处理
    const fatal = ['no_such_room', 'not_found'].includes(payload.code);
    if (fatal) toast.error(payload.message);
    else if (payload.code === 'muted') toast.warning(payload.message);
    else if (payload.code !== 'rate_limited') toast.error(payload.message);
  });

  client.on('updated', ({ message }) => {
    const idx = state.messages.findIndex((m) => m.id === message.id);
    if (idx < 0) return;
    state.messages[idx] = { ...state.messages[idx], ...message };
    replaceNode(state.messages[idx]);
  });

  client.on('deleted', ({ id }) => {
    const target = state.messages.find((m) => m.id === id);
    if (!target) return;
    target.deleted = true;
    target.body = '';
    target.reactions = [];
    replaceNode(target);
  });

  client.on('reaction', ({ id, reactions }) => {
    const target = state.messages.find((m) => m.id === id);
    if (!target) return;
    target.reactions = reactions;
    const node = nodeFor({ id });
    if (!node) return;
    // 替换掉消息里那个空容器，否则每点一次就多挂一个 .msg-reactions
    const box = node.querySelector('.msg-reactions');
    const fresh = renderReactions(target);
    if (box) box.replaceWith(fresh);
    else node.append(fresh);
  });

  client.on('presence', ({ room, online, onlineList }) => {
    // 只有当前所在房间的成员列表才替换；其它房间只需刷新角标
    if (room !== state.room) {
      renderRooms();
      return;
    }
    state.online = onlineList || [];
    state.onlineCount = online;
    renderPeople();
    updateOnlineBadge();
  });

  client.on('entered', ({ nickname }) => {
    if (client.room !== state.room) return;
    systemLine(`${nickname} 加入了聊天室`);
  });

  client.on('exited', ({ nickname, reason }) => {
    if (client.room !== state.room) return;
    systemLine(reason === 'switch' ? `${nickname} 去了别的房间` : `${nickname} 离开了聊天室`);
  });

  client.on('typing', ({ who, room: r }) => {
    if (r && r !== state.room) return;
    state.typing = who || [];
    renderTyping();
  });

  client.on('history', ({ room, items, hasMore, cursor }) => {
    if (room !== state.room) return;
    const anchor = log.scrollHeight - log.scrollTop;
    state.messages = [...items, ...state.messages];
    state.hasMore = hasMore;
    state.cursor = cursor;
    renderLog();
    // 保持用户当前视口，而不是直接跳到顶
    log.scrollTop = log.scrollHeight - anchor;
    state.atBottom = false;
    updateJump();
  });

  client.on('cleared', ({ room }) => {
    if (room !== state.room) return;
    state.messages = [];
    renderLog();
    toast.info('管理员清空了本房间');
  });

  client.on('muted', ({ status }) => {
    client.muted = status;
    sendBtn.disabled = true;
    composer.placeholder = '你已被禁言，无法发言';
    toast.error('你已被禁言');
  });

  client.on('nick', ({ nickname }) => {
    nickInput.value = nickname;
    updatePeople();
  });

  client.on('retry', ({ attempt, delay }) => {
    statusText.textContent = `重连中…（第 ${attempt} 次，${Math.round(delay / 1000)}s 后重试）`;
  });

  client.on('queued', ({ size }) => {
    statusText.textContent = `离线，${size} 条待发送`;
  });

  client.on('flushed', ({ count }) => {
    if (count) toast.success(`已补发 ${count} 条离线消息`);
  });

  client.connect();

  /* ---------- 渲染 ---------- */

  const renderAll = () => {
    renderTopbar();
    renderRooms();
    renderPeople();
    renderLog();
    renderComposerMeta();
  };

  function renderTopbar() {
    const room = state.rooms.find((r) => r.slug === state.room);
    clear(topBar).append(
      // statusDot / statusText / onlineText 都是常驻节点：清空前先记住，renderTopbar 每次重建
      el('div.row', {}, [statusDot, el('strong', {}, room?.name || '聊天室'), statusText, onlineText]),
      el('div.row.gap-1', {}, [
        el('span.chat-badge', { title: '消息上限' }, `${state.messages.length}/${MAX_RENDER}`),
        el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => client.reconnectNow() }, '重新连接'),
        el('button.btn.btn-ghost.btn-sm', {
          type: 'button',
          title: '清除本机保存的昵称与草稿',
          onclick: () => {
            clearDrafts();
            localStorage.removeItem('hub.nick');
            nickInput.value = '';
            toast.success('已清除本机聊天草稿与昵称');
          },
        }, '清本机缓存'),
      ]),
    );
    updateOnlineBadge();
    roomInfoBox.replaceChildren(
      el('div.chat-room-name', {}, room?.name || state.room),
      el('div.small.muted', {}, room?.topic || '暂无主题'),
      el('div.chat-kv', {}, [el('span', {}, '房间'), el('span', {}, state.room)]),
      el('div.chat-kv', {}, [el('span', {}, '在线'), el('span', {}, `${state.onlineCount || 0} 人`)]),
      el('div.chat-kv', {}, [el('span', {}, '延迟'), el('span', {}, client.latency != null ? `${client.latency}ms` : '—')]),
    );
  }

  function updateOnlineBadge() {
    const total = state.onlineCount ?? state.online.length;
    onlineText.textContent = `· 本房间 ${total} 人 / 全站 ${state.onlineTotal} 人`;
  }

  function renderRooms() {
    clear(roomList);
    for (const room of state.rooms) {
      const active = room.slug === state.room;
      const unread = Number(room.unread || 0);
      const btn = el(
        'button.chat-room',
        {
          type: 'button',
          role: 'tab',
          'aria-selected': active ? 'true' : 'false',
          class: active ? 'is-active' : '',
          onclick: () => {
            if (room.slug !== state.room) client.join(room.slug);
          },
        },
        [
          el('span.chat-room-name', {}, [room.name, room.kind === 'system' ? el('span.tag.tag-sm', {}, '系统') : null]),
          el('span.small.muted', {}, room.topic || '—'),
          el('span.chat-room-meta', {}, [
            el('span', { title: '在线人数' }, `👤 ${room.online || 0}`),
            unread ? el('span.chat-unread', { title: `${unread} 条未读` }, unread > 99 ? '99+' : String(unread)) : null,
          ]),
        ],
      );
      roomList.append(btn);
    }
  }

  function renderPeople() {
    clear(peopleList);
    if (!state.online.length) {
      peopleList.append(el('div.small.muted', {}, '本房间暂无其他人'));
      return;
    }
    for (const nick of state.online) {
      const isMe = nick === (client.you?.nickname || nickInput.value);
      peopleList.append(
        el('div.chat-person', { class: isMe ? 'is-me' : '' }, [
          el('span.chat-avatar-dot'),
          el('span.chat-person-name', { title: isMe ? '这是你' : nick }, nick + (isMe ? '（我）' : '')),
        ]),
      );
    }
  }

  function updatePeople() {
    renderPeople();
  }

  function renderTyping() {
    const who = state.typing.filter((n) => n !== (client.you?.nickname || nickInput.value));
    typingLine.textContent = '';
    if (!who.length) return;
    typingLine.append(
      el('span.chat-typing-dots', {}, [el('i'), el('i'), el('i')]),
      el('span', {}, who.length === 1 ? `${who[0]} 正在输入…` : `${who.slice(0, 3).join('、')}${who.length > 3 ? ` 等 ${who.length} 人` : ''} 正在输入…`),
    );
  }

  /** 消息分组：同一人 5 分钟内连发合并，头像与昵称只显示一次 */
  function groupFlags() {
    const out = [];
    for (let i = 0; i < state.messages.length; i++) {
      const m = state.messages[i];
      const prev = state.messages[i - 1];
      const sameDay = prev && dayKey(prev.createdAt) === dayKey(m.createdAt);
      const sameAuthor = prev && prev.nickname === m.nickname && !!m.userId && prev.userId === m.userId;
      const close = prev && Math.abs(new Date(m.createdAt) - new Date(prev.createdAt)) < GROUP_WINDOW_MS;
      const showDay = !sameDay;
      const head = showDay || !sameAuthor || !close;
      out.push({ showDay, head, first: !head });
    }
    return out;
  }

  function renderLog() {
    log.querySelector('.empty')?.remove();
    clear(log);
    if (state.loadingOlder) log.append(el('div.chat-hint', {}, '正在加载更早的消息…'));
    else if (state.hasMore) {
      log.append(
        el('button.chat-loadmore', { type: 'button', onclick: loadOlder }, state.hasMore ? '加载更早的消息' : ''),
      );
    }
    if (!state.messages.length) {
      log.append(
        empty('还没有消息', '说点什么，打个招呼吧', null, '💬'),
      );
      return;
    }
    const flags = groupFlags();
    let lastDay = null;
    flags.forEach((f, i) => {
      const m = state.messages[i];
      if (f.showDay && dayKey(m.createdAt) !== lastDay) {
        lastDay = dayKey(m.createdAt);
        log.append(el('div.chat-day', {}, dayLabel(m.createdAt)));
      }
      log.append(buildMessageNode(m, f));
    });
  }

  function buildMessageNode(m, flags = {}) {
    const f = flags || { showDay: true, head: true, first: false };
    const mine = m.isMe;
    const system = m.kind === 'system' || m.kind === 'action';
    const mentionable = state.online;

    if (m.deleted) {
      return el(`div.msg${mine ? '.me' : ''}.is-deleted`, { dataset: { id: m.id } }, [
        el('div.msg-body', {}, el('div.msg-bubble.tombstone', {}, '消息已删除')),
      ]);
    }

    const bubble = el('div.msg-bubble');
    if (m.replyTo) {
      bubble.append(
        el('div.msg-quote', {
          title: '点击跳转到原消息',
          onclick: () => jumpTo(m.replyTo.id),
        }, [el('span.msg-quote-who', {}, m.replyTo.nickname), el('span.msg-quote-body', {}, m.replyTo.body || '（已删除）')]),
      );
    }
    const textWrap = el('div.msg-text');
    if (m.kind === 'action') {
      textWrap.append(el('em.msg-action', {}, m.body));
    } else {
      renderBody(textWrap, m.body, { mentionable });
    }
    bubble.append(textWrap);

    if (m.editedAt) bubble.append(el('span.msg-edited', { title: `编辑于 ${new Date(m.editedAt).toLocaleString('zh-CN')}` }, '已编辑'));

    const meta = el('div.msg-meta', {}, [
      el('time.msg-time', { datetime: m.createdAt, title: new Date(m.createdAt).toLocaleString('zh-CN') }, clock(m.createdAt)),
      m.pending ? el('span.msg-state', {}, '发送中…') : null,
      m.failed ? el('span.msg-state.is-error', { title: m.failed }, '发送失败') : null,
    ]);

    const actions = el('div.msg-actions');
    if (!system) {
      actions.append(
        el('button.msg-action-btn', { type: 'button', title: '回复', onclick: () => startReply(m) }, '回复'),
        el('button.msg-action-btn', { type: 'button', title: '表情回应', onclick: (e) => toggleEmojiBar(e.currentTarget, m) }, '☺'),
      );
      if (m.canEdit) actions.append(el('button.msg-action-btn', { type: 'button', title: '编辑', onclick: () => startEdit(m) }, '编辑'));
      if (m.canDelete) actions.append(el('button.msg-action-btn', { type: 'button', title: '删除', onclick: () => doDelete(m) }, '删除'));
      actions.append(el('button.msg-action-btn', { type: 'button', title: '复制', onclick: () => copyText(m.body) }, '复制'));
    }

    const wrap = el(`div.msg${mine ? '.me' : ''}`, {
      dataset: { id: m.id, client: m.clientId || '' },
      title: `${m.nickname} · ${new Date(m.createdAt).toLocaleString('zh-CN')}`,
    });
    const row = el('div.msg-row', {}, [
      el('div.msg-avatar', {}, f.head ? avatarFor(m) : null),
      el('div.msg-stack', {}, [
        el('div.msg-head', {}, [f.head ? el('span.msg-who', {}, m.nickname) : null, m.pending ? null : meta]),
        bubble,
        renderReactions(m),
      ]),
    ]);
    wrap.append(row, actions);
    if (m.pending) wrap.classList.add('is-pending');
    if (m.failed) wrap.classList.add('failed');
    return wrap;
  }

  function avatarFor(m) {
    if (m.userId && store.user?.id === m.userId) return avatarFramed(store.user, 'sm');
    return el('span.msg-avatar-fallback', {}, (m.nickname || '?').slice(0, 1).toUpperCase());
  }

  function renderReactions(m) {
    const box = el('div.msg-reactions');
    if (!m.reactions?.length) return box;
    for (const r of m.reactions) {
      box.append(
        el(`button.reaction${r.mine ? '.is-mine' : ''}`, {
          type: 'button',
          title: `${r.count} 人`,
          onclick: () => client.react(m.id, r.emoji),
        }, [el('span', {}, r.emoji), el('span.reaction-count', {}, String(r.count))]),
      );
    }
    return box;
  }

  function nodeFor(m) {
    return log.querySelector(`[data-id="${cssEscape(m.id)}"]`);
  }

  /**
   * 就地重渲染一条消息。
   * prevId 必须传「改 id 之前」的值：乐观气泡转正时先把 id 换成服务端 id，
   * 此时再按新 id 查询 DOM 会查不到，节点就会永远停在「发送中」。
   */
  function replaceNode(m, prevId = null) {
    const old = nodeFor(prevId ? { id: prevId } : m);
    if (!old) return false;
    const flags = groupFlags();
    const idx = state.messages.indexOf(m);
    const fresh = buildMessageNode(m, flags[idx] || {});
    old.replaceWith(fresh);
    return true;
  }

  /** 乐观消息转正：先摘旧节点，再合并服务端字段 */
  function settleMessage(optimistic, message) {
    const prevId = optimistic.id;
    Object.assign(optimistic, message, { pending: false, clientId: null, failed: null });
    if (!replaceNode(optimistic, prevId)) {
      // 节点被裁剪掉了：直接追加，避免消息凭空消失
      appendNode(optimistic);
    }
  }

  function appendNode(m, { animate = false } = {}) {
    const node = buildMessageNode(m, { showDay: true, head: true, first: false });
    if (animate) node.classList.add('is-new');
    log.append(node);
  }

  /** 超过上限时从顶部裁剪，保留最新 */
  function pruneDom() {
    while (log.children.length > MAX_RENDER + 4) {
      const first = log.firstElementChild;
      if (!first || first.classList.contains('chat-day')) break;
      first.remove();
      if (state.messages.length > MAX_RENDER) state.messages.shift();
    }
  }

  function scrollIfPinned(force = false) {
    if (state.atBottom || force) scrollBottom();
    else bumpUnread(state.room, { silent: true });
  }

  function scrollBottom(smooth = false) {
    log.scrollTo({ top: log.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    state.atBottom = true;
    state.unread = 0;
    updateJump();
    markRead();
  }

  function updateJump() {
    const show = !state.atBottom;
    jumpBtn.hidden = !show;
    if (show) {
      const badge = jumpBtn.querySelector('.chat-jump-badge');
      badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
      badge.hidden = state.unread === 0;
    }
  }

  function bumpUnread(room, { silent = false } = {}) {
    if (room === state.room) {
      state.unread += 1;
      updateJump();
      return;
    }
    const target = state.rooms.find((r) => r.slug === room);
    if (target) target.unread = Number(target.unread || 0) + 1;
    renderRooms();
    if (!silent) toast.info(`${room} 有新消息`);
  }

  /** 后台标签页时用标题闪烁提醒，回到前台自动复原 */
  function maybeNotify(m) {
    if (m.isMe || document.visibilityState === 'visible') return;
    // 防打扰：10 秒内只提醒一次
    const now = Date.now();
    if (now - (notifyLast || 0) < 10_000) return;
    notifyLast = now;
    startTitleFlash(`新消息 · ${m.nickname}`);
  }

  let notifyLast = 0;
  let baseTitle = document.title;
  let flashTimer = null;

  /** 标题闪烁；回到前台立刻停掉并复原标题 */
  function startTitleFlash(prefix) {
    if (flashTimer) return;
    baseTitle = document.title;
    let flip = false;
    flashTimer = setInterval(() => {
      flip = !flip;
      document.title = flip ? `(${prefix}) ${baseTitle}` : baseTitle;
    }, 1200);
    // 注意：不能加 { once }，否则「切到后台」那次就会把监听消费掉，
    // 回到前台时反而不会复原标题。
    addEventListener('visibilitychange', onTitleVisible, { once: true });
  }

  function onTitleVisible() {
    if (document.visibilityState !== 'visible') {
      // 又切走了，重新挂上监听
      addEventListener('visibilitychange', onTitleVisible, { once: true });
      return;
    }
    stopTitleFlash();
  }

  function stopTitleFlash() {
    if (flashTimer) {
      clearInterval(flashTimer);
      flashTimer = null;
    }
    if (baseTitle) document.title = baseTitle;
    removeEventListener('visibilitychange', onTitleVisible);
  }

  function systemLine(text) {
    log.querySelector('.empty')?.remove();
    const node = el('div.msg.system', {}, el('div.msg-bubble', {}, text));
    log.append(node);
    pruneDom();
    scrollIfPinned();
  }

  function jumpTo(id) {
    const node = nodeFor({ id });
    if (!node) return toast.info('原消息不在当前已加载的范围内');
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.add('is-flash');
    setTimeout(() => node.classList.remove('is-flash'), 1400);
  }

  function loadOlder() {
    if (state.loadingOlder || !state.hasMore) return;
    state.loadingOlder = true;
    renderLog();
    client.loadMore(state.room, state.cursor);
    // 服务端无响应时兜底解锁，避免按钮永久卡在「加载中」
    setTimeout(() => {
      if (state.loadingOlder) {
        state.loadingOlder = false;
        renderLog();
      }
    }, 4000);
  }

  function markRead() {
    // 已读位点按 actor 记录，游客也能标已读
    const last = state.messages.at(-1)?.createdAt;
    if (last) client.markRead(state.room, last);
  }

  /* ---------- 输入与发送 ---------- */

  function renderComposerMeta() {
    const max = client.limits.bodyMax || 2000;
    composer.maxLength = max;
    const len = composer.value.length;
    charCount.textContent = `${len}/${max}`;
    charCount.classList.toggle('is-warn', len > max * 0.9);
    // 自适应高度，最多 6 行
    composer.style.height = 'auto';
    composer.style.height = `${Math.min(composer.scrollHeight, 132)}px`;
    if (client.muted) {
      sendBtn.disabled = true;
      composer.placeholder = '你已被禁言，无法发言';
    }
  }

  function send() {
    if (state.editing) return submitEdit();
    const text = composer.value.trim();
    if (!text) return;
    if (!store.user && !nickInput.value.trim()) {
      toast.warning('请先填写昵称');
      nickInput.focus();
      return;
    }
    if (!store.user) {
      client.setNickname(nickInput.value.trim());
      localStorage.setItem('hub.nick', nickInput.value.trim());
    }
    const res = client.send(text, { replyTo: state.replyTo?.id || null });
    if (!res) return;
    // 乐观上屏：先插一条 pending，服务端确认后转正
    const optimistic = {
      id: `tmp-${res.clientId}`,
      clientId: res.clientId,
      room: state.room,
      kind: 'chat',
      body: text,
      nickname: client.you?.nickname || nickInput.value.trim(),
      userId: store.user?.id || null,
      isMe: true,
      canEdit: false,
      canDelete: false,
      deleted: false,
      pending: true,
      reactions: [],
      replyTo: state.replyTo ? { ...state.replyTo } : null,
      createdAt: new Date().toISOString(),
    };
    state.messages.push(optimistic);
    appendNode(optimistic, { animate: true });
    log.querySelector('.empty')?.remove();
    scrollBottom(true);
    composer.value = '';
    state.replyTo = null;
    renderReplyBar();
    saveDraft(state.room, '');
    renderComposerMeta();
  }

  function renderReplyBar() {
    replyBar.hidden = !state.editing && !state.replyTo;
    clear(replyBar);
    if (state.editing) {
      replyBar.append(
        el('span.chat-reply-tag.is-edit', {}, '编辑消息'),
        el('span.chat-reply-text', {}, state.editing.body),
        el('button.chat-reply-x', { type: 'button', title: '取消编辑', onclick: cancelEdit }, '✕'),
      );
      return;
    }
    if (state.replyTo) {
      replyBar.append(
        el('span.chat-reply-tag', {}, `回复 ${state.replyTo.nickname}`),
        el('span.chat-reply-text', {}, state.replyTo.body),
        el('button.chat-reply-x', { type: 'button', title: '取消回复', onclick: () => { state.replyTo = null; renderReplyBar(); } }, '✕'),
      );
    }
  }

  function startReply(m) {
    state.editing = null;
    state.replyTo = { id: m.id, nickname: m.nickname, body: m.body };
    renderReplyBar();
    composer.focus();
  }

  function startEdit(m) {
    state.replyTo = null;
    state.editing = m;
    composer.value = m.body;
    renderReplyBar();
    renderComposerMeta();
    composer.focus();
  }

  function cancelEdit() {
    state.editing = null;
    composer.value = loadDraft(state.room);
    renderReplyBar();
    renderComposerMeta();
  }

  function submitEdit() {
    const target = state.editing;
    const text = composer.value.trim();
    if (!target || !text) return;
    client.edit(target.id, text);
    state.editing = null;
    composer.value = loadDraft(state.room);
    renderReplyBar();
    renderComposerMeta();
  }

  async function doDelete(m) {
    const yes = await confirmDialog({
      title: '删除消息',
      message: '删除后该消息会显示为「消息已删除」，引用它的回复也会变成占位。此操作不可撤销。',
      confirmText: '删除',
      danger: true,
    });
    if (!yes) return;
    client.remove(m.id);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('已复制');
    } catch {
      toast.warning('复制失败，请手动选择');
    }
  }

  /* ---------- 表情 / 提及 / 指令 补全 ---------- */

  function toggleEmojiBar(anchor, m) {
    const existing = log.querySelector('.chat-emoji-pop');
    existing?.remove();
    const pop = el('div.chat-emoji-pop', {}, [
      ...(client.limits.reactions?.length ? client.limits.reactions : QUICK_EMOJI).map((e) =>
        el('button.chat-emoji-btn', { type: 'button', onclick: () => { client.react(m.id, e); pop.remove(); } }, e),
      ),
    ]);
    anchor.closest('.msg')?.append(pop);
    setTimeout(() => {
      const off = (ev) => {
        if (!pop.contains(ev.target)) {
          pop.remove();
          document.removeEventListener('click', off);
        }
      };
      document.addEventListener('click', off);
    }, 0);
  }

  function showSuggestions(kind, items, onPick) {
    const panel = kind === 'mention' ? mentionPanel : commandPanel;
    clear(panel);
    if (!items.length) {
      panel.hidden = true;
      return;
    }
    items.slice(0, 8).forEach((item, i) => {
      panel.append(
        el('button.chat-suggest', { type: 'button', dataset: { i: String(i) }, onclick: () => onPick(item) }, item.label),
      );
    });
    panel.hidden = false;
  }

  function detectSuggest() {
    const value = composer.value;
    const caret = composer.selectionStart ?? value.length;
    const head = value.slice(0, caret);

    // / 指令：只在行首触发
    const cmd = /(?:^|\n)\/([a-z]*)$/i.exec(head);
    if (cmd) {
      const q = cmd[1].toLowerCase();
      const items = (client.commands || [])
        .filter((c) => c.cmd.toLowerCase().includes('/' + q) || c.desc.includes(q))
        .map((c) => ({ label: `${c.usage} — ${c.desc}`, value: `${c.usage} `, from: cmd.index + (head[cmd.index] === '\n' ? 1 : 0), to: caret }));
      showSuggestions('command', items, (item) => {
        composer.value = value.slice(0, item.from) + item.value + value.slice(caret);
        composer.focus();
        composer.selectionStart = composer.selectionEnd = item.from + item.value.length;
        commandPanel.hidden = true;
      });
      return;
    }
    commandPanel.hidden = true;

    // @提及
    const men = /@([^\s@]{0,20})$/.exec(head);
    if (men) {
      const q = men[1].toLowerCase();
      const pool = [...new Set(state.online)].filter((n) => n !== (client.you?.nickname || ''));
      const items = pool
        .filter((n) => n.toLowerCase().includes(q))
        .map((n) => ({ label: n, value: `@${n} `, from: caret - men[1].length - 1, to: caret }));
      showSuggestions('mention', items, (item) => {
        composer.value = value.slice(0, item.from) + item.value + value.slice(caret);
        composer.focus();
        composer.selectionStart = composer.selectionEnd = item.from + item.value.length;
        mentionPanel.hidden = true;
      });
      return;
    }
    mentionPanel.hidden = true;
  }

  /* ---------- 事件绑定 ---------- */

  composer.addEventListener('input', () => {
    renderComposerMeta();
    saveDraft(state.room, composer.value);
    client.typing();
    detectSuggest();
  });

  composer.addEventListener('keydown', (e) => {
    const panel = !mentionPanel.hidden ? mentionPanel : !commandPanel.hidden ? commandPanel : null;
    if (panel) {
      const items = [...panel.children];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const cur = items.findIndex((n) => n.classList.contains('is-active'));
        items.forEach((n) => n.classList.remove('is-active'));
        const next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
        items[next]?.classList.add('is-active');
        items[next]?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        items.find((n) => n.classList.contains('is-active'))?.click() || items[0]?.click();
        return;
      }
      if (e.key === 'Escape') {
        panel.hidden = true;
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === 'Escape' && state.editing) cancelEdit();
  });

  composer.addEventListener('blur', () => {
    saveDraft(state.room, composer.value);
    client.stopTyping();
  });

  sendBtn.addEventListener('click', send);

  nickInput.addEventListener('change', () => {
    const nick = nickInput.value.trim();
    if (!nick || store.user) return;
    client.setNickname(nick);
  });

  quickBox.addEventListener('click', (e) => {
    const btn = e.target.closest('.chat-quick-btn');
    if (!btn) return;
    const at = composer.selectionStart ?? composer.value.length;
    composer.value = composer.value.slice(0, at) + btn.textContent + composer.value.slice(at);
    composer.focus();
    composer.selectionStart = composer.selectionEnd = at + btn.textContent.length;
    renderComposerMeta();
  });

  emojiPanel.addEventListener('click', (e) => {
    const btn = e.target.closest('.chat-emoji-btn');
    if (!btn) return;
    const at = composer.selectionStart ?? composer.value.length;
    composer.value = composer.value.slice(0, at) + btn.textContent + composer.value.slice(at);
    composer.focus();
    composer.selectionStart = composer.selectionEnd = at + btn.textContent.length;
    renderComposerMeta();
  });

  log.addEventListener('scroll', () => {
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    state.atBottom = near;
    if (near) {
      state.unread = 0;
      markRead();
    }
    updateJump();
  });

  jumpBtn.addEventListener('click', () => scrollBottom(true));

  // 双击顶部加载更早
  log.addEventListener('scroll', () => {
    if (log.scrollTop < 40) loadOlder();
  });

  searchInput.addEventListener('input', () => {
    state.filter = searchInput.value.trim().toLowerCase();
    runSearch();
  });

  let searchTimer = null;
  function runSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      clear(resultsBox);
      if (!state.filter) return;
      const hits = state.messages.filter(
        (m) => !m.deleted && (m.body.toLowerCase().includes(state.filter) || m.nickname.toLowerCase().includes(state.filter)),
      );
      resultsBox.append(
        el('div.small.muted', {}, hits.length ? `命中 ${hits.length} 条（仅已加载范围）` : '无匹配'),
      );
      for (const m of hits.slice(0, 30)) {
        resultsBox.append(
          el('button.chat-result', { type: 'button', onclick: () => { jumpTo(m.id); searchInput.value = ''; state.filter = ''; clear(resultsBox); } }, [
            el('span.chat-result-who', {}, m.nickname),
            el('span.chat-result-body', {}, m.body.slice(0, 60)),
          ]),
        );
      }
    }, 180);
  }

  // 未读房间角标：页面重新可见时同步
  const onVisible = () => {
    if (document.visibilityState === 'visible' && state.atBottom) markRead();
  };
  document.addEventListener('visibilitychange', onVisible);

  // 恢复草稿
  composer.value = loadDraft(state.room);
  renderComposerMeta();
  renderRooms();
  renderPeople();
  renderLog();
  renderTopbar();
  composer.focus();

  const onUnload = () => client.close();
  window.addEventListener('pagehide', onUnload, { once: true });

  // SPA 路由切换时由 router 调用：断开连接、清定时器、摘全局监听
  return function teardown() {
    client.close();
    if (activeClient === client) activeClient = null;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pagehide', onUnload);
    stopTitleFlash();
    clearTimeout(searchTimer);
    log.querySelector('.chat-emoji-pop')?.remove();
  };
}

/** CSS.escape 的兜底实现（属性选择器里 id 可能以数字开头） */
function cssEscape(value) {
  const raw = String(value ?? '');
  if (window.CSS?.escape) return window.CSS.escape(raw);
  return raw.replace(/([^\w-])/g, '\\$1');
}
