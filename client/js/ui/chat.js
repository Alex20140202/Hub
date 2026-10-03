import { el, $, $$ } from '../lib/dom.js';
import { toast, toastErr } from './toast.js';
import { fromNow, formatDate, formatBytes } from '../lib/format.js';
import { api } from '../lib/api.js';

const RETRY_STEPS = [1000, 2000, 4000, 8000, 15000];
const MAX_ATTACHMENT = 25 * 1024 * 1024;

/**
 * 聊天室客户端：一条 WebSocket 连接同时订阅多个房间（大厅 + 群 + 私聊）。
 * 断线按指数退避重连，重连后自动重新 join 已加入过的房间。
 */
export function createChat({ log, room, status, membersPanel, onRoomChange }) {
  if (!log) return null;

  let socket = null;
  let retry = 0;
  let closedByUser = false;
  const roomAttr = log.dataset.room || 'lobby'; // 首屏所在的房间
  const joined = new Set(['lobby', roomAttr]); // 需要订阅的房间（含首屏房间）
  const nick = log.dataset.nick || '访客';
  const authenticated = log.dataset.auth === '1';
  const root = log.closest('.chat-layout') ?? document;
  let loadingOlder = false;

  const scrollToEnd = () => {
    log.scrollTop = log.scrollHeight;
  };
  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;

  const setStatus = (text, tone = '') => {
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone;
  };

  /* ------------------------------- 消息渲染 ------------------------------- */

  /** 气泡结构必须与 server/views/modules.js 的 chatBubble 保持一致。 */
  const bubble = (message) => {
    if (message.kind === 'system') return el('p', { class: 'chat-system', dataset: { id: message.id } }, [message.body]);
    if (message.kind === 'action') {
      return el('p', { class: 'chat-action', dataset: { id: message.id } }, [
        el('strong', {}, [message.nickname]),
        ` ${message.body}`,
      ]);
    }

    const stamp = formatDate(message.createdAt, true);
    const readCount = (message.reads?.length ?? 0) + 1;
    const canPin = roomAttr !== 'lobby';

    const wrap = el('div', { class: 'chat-bubble-wrap' }, [el('span', { class: 'chat-nick' }, [message.nickname])]);

    if (message.quote) {
      wrap.append(
        el(
          'a',
          { class: 'chat-quote', href: `#msg-${message.quote.id}`, dataset: { jump: message.quote.id } },
          [el('strong', {}, [message.quote.nickname]), el('em', {}, [message.quote.body])],
        ),
      );
    }

    if (message.attachment) {
      const a = message.attachment;
      wrap.append(
        el('a', { class: 'chat-file', href: a.url, download: '', dataset: { fileId: a.id } }, [
          el('span', { class: 'chat-file-icon' }, [(a.name.split('.').pop() ?? 'file').slice(0, 4).toUpperCase()]),
          el('span', { class: 'chat-file-text' }, [
            el('strong', {}, [a.name]),
            el('em', {}, [`${formatBytes(a.size)} · ${a.downloads} 次下载`]),
          ]),
          el('span', { class: 'chat-file-dl' }, ['↓']),
        ]),
      );
    } else {
      wrap.append(el('div', { class: 'chat-bubble' }, [message.body]));
    }

    const time = el('time', { class: 'chat-time', title: stamp }, [fromNow(message.createdAt)]);
    const meta = el('span', { class: 'chat-meta' }, [time]);
    if (readCount > 1) meta.append(el('em', { class: 'chat-reads' }, [`${readCount} 已读`]));

    const hover = el('span', { class: 'chat-hover' }, [
      el(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          title: '回复',
          'aria-label': '回复',
          dataset: {
            action: 'reply-to',
            id: message.id,
            nick: message.nickname,
            body: String(message.body || '').slice(0, 60),
          },
        },
        ['↩'],
      ),
      ...(canPin
        ? [
            el(
              'button',
              { class: 'icon-btn', type: 'button', title: '置顶为群公告', 'aria-label': '置顶', dataset: { action: 'pin-message', room: roomAttr, id: message.id } },
              ['📌'],
            ),
          ]
        : []),
    ]);

    return el(
      'div',
      {
        class: `chat-row${message.isMine ? ' is-mine' : ''}`,
        id: `msg-${message.id}`,
        dataset: { id: message.id, reads: String(readCount) },
      },
      [
        el('span', { class: 'avatar avatar-sm chat-avatar', style: `--hue:${(message.nickname || '').length * 37 % 360}` }, [
          (message.nickname || '?').slice(0, 1).toUpperCase(),
        ]),
        wrap,
        meta,
        hover,
      ],
    );
  };

  /** 与服务端 withDateDividers 一致：跨天插入日期线。 */
  const withDividers = (messages) => {
    const out = [];
    let lastDay = '';
    for (const message of messages) {
      const day = String(message.createdAt ?? '').slice(0, 10);
      if (day !== lastDay) {
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const label = day === today ? '今天' : day === yesterday ? '昨天' : day;
        out.push(el('div', { class: 'chat-daysep' }, [el('span', {}, [label])]));
        lastDay = day;
      }
      out.push(bubble(message));
    }
    return out;
  };

  const append = (message) => {
    log.querySelector('.chat-hint')?.remove();
    const stick = atBottom();
    // 跨天时补日期分隔线
    const rows = [...log.querySelectorAll('.chat-row, .chat-action, .chat-system')];
    const lastNode = rows.at(-1);
    const lastDay = lastNode?.dataset?.day;
    if (message.kind === 'chat' || message.kind === 'file') {
      const day = String(message.createdAt ?? '').slice(0, 10);
      if (lastDay !== day) {
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const label = day === today ? '今天' : day === yesterday ? '昨天' : day;
        const divider = el('div', { class: 'chat-daysep', dataset: { day } }, [el('span', {}, [label])]);
        log.append(divider);
        lastNode?.setAttribute?.('data-day', day);
      }
    }
    log.append(bubble(message));
    if (stick) scrollToEnd();
  };

  const renderAll = (messages, { hasMore = false } = {}) => {
    log.replaceChildren();
    const oldest = messages[0]?.id;
    if (oldest) log.dataset.oldest = oldest;

    // 只有服务端说「还有更早的」才显示加载入口
    if (hasMore) {
      log.append(
        el('div', { class: 'chat-load', dataset: { loadMore: '' } }, [
          el('button', { class: 'btn btn-ghost', type: 'button', dataset: { action: 'load-older' } }, ['加载更早的消息']),
        ]),
      );
    }

    if (!messages.length) {
      log.append(el('p', { class: 'hint chat-hint' }, ['还没有消息，说点什么吧。']));
      return;
    }
    log.append(...withDividers(messages));
    scrollToEnd();
  };

  /* -------------------------------- 连接 -------------------------------- */

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    // 同源握手会自动带上 hub_session Cookie，无需手动传令牌
    const socketUrl = `${protocol}://${location.host}/ws`;

    socket = new WebSocket(socketUrl);

    socket.addEventListener('open', () => {
      retry = 0;
      // 必须先 join 再 switch：switch 只接受已加入的房间
      for (const code of joined) send({ type: 'join', room: code });
      send({ type: 'switch', room: roomAttr });
      setStatus(authenticated ? `以 ${nick} 身份在线` : '游客模式，登录后可发言', 'ok');
    });

    socket.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      handle(payload);
    });

    socket.addEventListener('close', () => {
      if (closedByUser) return;
      const delay = RETRY_STEPS[Math.min(retry, RETRY_STEPS.length - 1)];
      retry += 1;
      setStatus(`连接已断开，${Math.round(delay / 1000)} 秒后重连…`, 'warn');
      setTimeout(() => {
        if (!closedByUser) connect();
      }, delay);
    });

    socket.addEventListener('error', () => setStatus('连接出错，正在重试…', 'warn'));
  }

  function handle(payload) {
    switch (payload.type) {
      case 'ready': {
        joined.add('lobby');
        // ready 只带大厅历史；当前在别的房间时，等 room 事件再渲染，避免被大厅内容覆盖
        if (roomAttr === 'lobby') renderAll(payload.messages ?? [], { hasMore: payload.hasMore });
        setOnline(payload.online);
        setStatus(authenticated ? `以 ${payload.you.nickname} 身份在线` : `以 ${payload.you.nickname} 身份在线（游客，仅可浏览）`, 'ok');
        return;
      }
      case 'room': {
        joined.add(payload.room);
        // 只有当前所在房间才重绘日志，避免别的房间消息把界面冲掉
        if (payload.room === roomAttr) {
          renderAll(payload.messages ?? [], { hasMore: payload.hasMore });
          setOnline(payload.online);
          renderPinned(payload.pinned);
          syncMuteButton(payload.muted);
          if (payload.room !== 'lobby') {
            api.rooms.read(payload.room).catch(() => {});
            // 上报最近这些消息的已读
            seen((payload.messages ?? []).slice(-12).map((message) => message.id));
          }
        }
        onRoomChange?.(payload.room);
        return;
      }
      case 'left': {
        joined.delete(payload.room);
        onRoomChange?.(payload.active);
        return;
      }
      case 'message': {
        if (payload.room !== roomAttr) {
          onRoomChange?.(payload.room, { unread: true });
          return;
        }
        append(payload.message);
        if (payload.room !== 'lobby') send({ type: 'read', room: payload.room });
        return;
      }
      case 'presence': {
        if (payload.room === roomAttr) setOnline(payload.online);
        return;
      }
      case 'pinned': {
        onRoomChange?.(payload.room, { pinned: payload.pinned });
        return;
      }
      case 'mute': {
        onRoomChange?.(payload.room, { muted: payload.muted, userId: payload.userId });
        return;
      }
      case 'seen': {
        // 已读回执：在气泡右下角更新「N 已读」
        for (const id of payload.messageIds ?? []) {
          const node = $(`#chat-log [data-id="${id}"]`);
          if (!node) continue;
          const slot = node.querySelector('.chat-reads');
          const count = (node.dataset.reads ?? '0') * 1 + 1;
          node.dataset.reads = String(count);
          if (slot) slot.textContent = `${count} 已读`;
          else if (count > 1) node.querySelector('.chat-meta')?.insertAdjacentHTML('beforeend', `<em class="chat-reads">${count} 已读</em>`);
        }
        return;
      }
      case 'room-update':
      case 'room-closed':
      case 'members-changed': {
        onRoomChange?.(payload.room, { members: true });
        return;
      }
      case 'deleted': {
        $(`#chat-log [data-id="${payload.messageId}"]`)?.remove();
        return;
      }
      case 'error': {
        toastErr(payload.message);
        return;
      }
      default:
    }
  }

  function renderPinned(pinned) {
    const bar = $('[data-pinned-bar]');
    if (!bar) return;
    if (!pinned) {
      bar.remove();
      return;
    }
    const text = pinned.quote?.body || pinned.body || '';
    bar.querySelector('.chat-pinned-text').textContent = text.slice(0, 160);
    bar.querySelector('.chat-pinned-who').textContent = pinned.nickname;
    bar.dataset.id = pinned.id;
  }

  function syncMuteButton(muted) {
    const button = $('[data-action="toggle-mute"]');
    if (!button || muted === undefined) return;
    button.textContent = muted ? '🔕' : '🔔';
    button.title = muted ? '取消免打扰' : '免打扰';
    button.classList.toggle('is-on', Boolean(muted));
  }

  function setOnline(count) {
    const badge = $('[data-online-count]');
    if (badge) badge.textContent = String(count ?? 0);
    const sub = $('[data-room-sub]');
    if (sub && count !== undefined) {
      const base = sub.dataset.base || sub.textContent.replace(/\s*·\s*在线 \d+ 人$/, '');
      sub.dataset.base = base;
      sub.textContent = `${base} · 在线 ${count} 人`;
    }
  }

  function send(payload) {
    if (socket?.readyState !== WebSocket.OPEN) {
      toastErr('尚未连接到聊天室，请稍候');
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }

  function sendText(text) {
    const body = String(text || '').trim();
    if (!body) return false;
    if (socket?.readyState !== WebSocket.OPEN) {
      toastErr('尚未连接到聊天室，请稍候');
      return false;
    }
    socket.send(JSON.stringify({ type: 'chat', body }));
    return true;
  }

  /* ------------------------------ 文件上传 ------------------------------ */

  async function sendFile(file) {
    if (!authenticated) return toastErr('请先登录后再发送文件');
    if (file.size > MAX_ATTACHMENT) return toastErr(`文件不能超过 ${formatBytes(MAX_ATTACHMENT)}`);
    setStatus(`正在上传 ${file.name}…`);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('folder', '聊天附件');
      const { file: uploaded } = await api.files.upload(body);
      if (send({ type: 'attach', fileId: uploaded.id })) {
        toastOk(`已发送 ${file.name}`);
      }
    } catch (error) {
      toastErr(error.message);
    } finally {
      setStatus(authenticated ? `以 ${nick} 身份在线` : '游客模式，登录后可发言', 'ok');
    }
  }

  const toastOk = (message) => toast(message, 'ok');

  const pickFile = () => {
    const picker = el('input', { type: 'file' });
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (file) await sendFile(file);
    });
    picker.click();
  };

  /* -------------------------------- 绑定 -------------------------------- */

  const form = $('[data-chat-form]');
  if (form) {
    const input = form.querySelector('[name="body"]');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (sendText(input.value)) input.value = '';
    });
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (sendText(input.value)) input.value = '';
      }
    });
  }

  // 拖拽文件到聊天区直接发送
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    root.addEventListener(type, stop);
  }
  root.addEventListener('drop', async (event) => {
    for (const file of [...(event.dataTransfer?.files ?? [])]) await sendFile(file);
  });

  document.addEventListener('visibilitychange', () => {
    if (!socket) return;
    if (document.hidden) socket.close?.();
    else if (socket.readyState === WebSocket.CLOSED) connect();
  });

  // 滚到顶部时自动加载更早的消息
  log.addEventListener('scroll', () => {
    if (log.scrollTop > 40 || loadingOlder) return;
    if (!log.dataset.oldest) return;
    loadingOlder = true;
    loadOlder()
      .catch(() => {})
      .finally(() => {
        loadingOlder = false;
      });
  });

  // 首屏内容由服务端渲染，这里只在建立连接后由 ready 事件统一重绘
  connect();
  scrollToEnd();

  /* ------------------------------ 对外接口 ------------------------------ */

  /** 引用回复：记录目标消息，视图层负责渲染提示条。 */
  let replyTarget = null;
  const setReplyTarget = (message) => {
    replyTarget = message;
    return replyTarget;
  };

  /** 上拉加载更早的消息。返回是否还有更多。 */
  async function loadOlder() {
    const oldest = Number(log.dataset.oldest || 0);
    if (!oldest) return false;
    const { items, hasMore } = await api.rooms.messages(roomAttr, { before: oldest });
    if (!items.length) return false;

    const previousHeight = log.scrollHeight;
    const marker = $('[data-load-more]', log);
    if (marker) marker.remove();
    // 倒序插入到最前面
    for (const message of items) {
      log.prepend(bubble(message));
    }
    log.dataset.oldest = items[0].id;
    // 保持视觉位置不跳
    log.scrollTop = log.scrollHeight - previousHeight;
    if (!hasMore) {
      const done = el('p', { class: 'chat-end' }, ['已经是最早的消息了']);
      log.prepend(done);
    }
    return Boolean(hasMore);
  }

  /** 房间内搜索。 */
  const search = (q) => api.rooms.search(roomAttr, q);

  /** 上报已读回执。 */
  function seen(messageIds) {
    if (!authenticated || !messageIds.length) return;
    send({ type: 'seen', room: roomAttr, messageIds });
  }

  return {
    send,
    sendText,
    sendFile,
    pickFile,
    connect,
    seen,
    search,
    loadOlder,
    setReplyTarget,
    getReplyTarget: () => replyTarget,
    room: () => roomAttr,
    join: (code) => {
      joined.add(code);
      send({ type: 'join', room: code });
    },
    close: () => {
      closedByUser = true;
      socket?.close();
    },
  };
}
