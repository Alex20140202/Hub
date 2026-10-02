import { el } from '../lib/dom.js';
import { toast, toastErr } from './toast.js';
import { fromNow, formatDate } from '../lib/format.js';

const RETRY_STEPS = [1000, 2000, 4000, 8000, 15000];

/**
 * 聊天室客户端：原生 WebSocket + 自动重连 + 指数退避。
 * 服务端在进入房间时下发历史消息，之后通过广播增量推送。
 */
export function createChat({ log, input, status, onlineBadge, onlineList, room = 'lobby' }) {
  if (!log) return null;

  let socket = null;
  let retry = 0;
  let closedByUser = false;
  const nick = log.dataset.nick || '访客';
  const authenticated = log.dataset.auth === '1';

  const scrollToEnd = () => {
    log.scrollTop = log.scrollHeight;
  };

  const setStatus = (text, tone = '') => {
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone;
  };

  const bubble = (message) => {
    if (message.kind === 'system') {
      return el('p', { class: 'chat-system' }, [message.body]);
    }
    if (message.kind === 'action') {
      return el('p', { class: 'chat-action' }, [el('strong', {}, [message.nickname]), ` ${message.body}`]);
    }
    const time = el('time', { class: 'chat-time' }, [formatDate(message.createdAt, true)]);
    time.title = fromNow(message.createdAt);
    return el('div', { class: `chat-row${message.isMine ? ' is-mine' : ''}`, dataset: { id: message.id } }, [
      el('span', { class: 'avatar avatar-sm chat-avatar', style: `--hue:${(message.nickname || '').length * 37 % 360}` }, [
        (message.nickname || '?').slice(0, 1).toUpperCase(),
      ]),
      el('div', { class: 'chat-bubble-wrap' }, [
        el('span', { class: 'chat-nick' }, [message.nickname]),
        el('div', { class: 'chat-bubble' }, [message.body]),
      ]),
      time,
    ]);
  };

  const append = (message) => {
    log.querySelector('.chat-hint')?.remove();
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.append(bubble(message));
    if (atBottom) scrollToEnd();
  };

  const setOnline = (count) => {
    if (onlineBadge) onlineBadge.textContent = String(count);
  };

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = new URL(`${protocol}://${location.host}/ws`);
    if (room !== 'lobby') url.searchParams.set('room', room);
    // 同源握手会自动带上 hub_session Cookie，无需手动传令牌

    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      retry = 0;
      setStatus(authenticated ? `以 ${nick} 身份在线` : '游客模式，登录后可显示昵称', 'ok');
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
    if (payload.type === 'ready') {
      log.replaceChildren();
      for (const message of payload.messages ?? []) log.append(bubble(message));
      scrollToEnd();
      setOnline(payload.online);
      setStatus(authenticated ? `以 ${payload.you.nickname} 身份在线` : `以 ${payload.you.nickname} 身份在线（游客）`, 'ok');
      if (onlineList) {
        onlineList.replaceChildren(
          el('li', { class: 'row' }, [
            el('span', { class: 'row-main' }, [
              el('span', { class: 'row-title' }, [payload.you.nickname]),
              el('span', { class: 'row-meta' }, [payload.you.authenticated ? '已登录' : '游客']),
            ]),
          ]),
        );
      }
      return;
    }
    if (payload.type === 'presence') {
      setOnline(payload.online);
      if (payload.joined) toast(`${payload.joined} 加入了聊天室`, 'info', 2000);
      if (payload.left) toast(`${payload.left} 离开了聊天室`, 'info', 2000);
      return;
    }
    if (payload.type === 'message') {
      append({ ...payload.message, isMine: false });
      return;
    }
    if (payload.type === 'error') {
      toastErr(payload.message);
    }
  }

  function send(text) {
    const body = String(text || '').trim();
    if (!body) return false;
    if (socket?.readyState !== WebSocket.OPEN) {
      toastErr('尚未连接到聊天室，请稍候');
      return false;
    }
    socket.send(JSON.stringify({ type: 'chat', body }));
    return true;
  }

  // 表单提交（也支持回车直接发）
  const form = document.querySelector('[data-chat-form]');
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (send(input.value)) input.value = '';
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (send(input.value)) input.value = '';
      }
    });
  }

  // 页面隐藏时不必保持连接
  document.addEventListener('visibilitychange', () => {
    if (!socket) return;
    if (document.hidden) socket.close?.();
    else if (socket.readyState === WebSocket.CLOSED) connect();
  });

  connect();
  scrollToEnd();

  return { send, connect, close: () => { closedByUser = true; socket?.close(); } };
}
