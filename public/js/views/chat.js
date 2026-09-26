import { el, clear, throttle } from '../lib/dom.js';
import { store, on } from '../lib/store.js';
import { PublicAPI, token } from '../lib/api.js';
import { clock, timeAgo } from '../lib/format.js';
import { avatar, empty } from '../ui/components.js';
import { toast } from '../ui/toast.js';

/** 极简 WebSocket 客户端，带自动重连 */
export class ChatSocket {
  constructor({ onOpen, onMessage, onClose, onStatus }) {
    this.handlers = { onOpen, onMessage, onClose, onStatus };
    this.ws = null;
    this.retry = 0;
    this.manualClose = false;
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const t = token.get();
    const nick = localStorage.getItem('hub.nick') || '';
    const url = `${proto}://${location.host}/ws?t=${Date.now()}${t ? `&token=${encodeURIComponent(t)}` : ''}${nick ? `&nick=${encodeURIComponent(nick)}` : ''}`;

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      this.handlers.onStatus?.('error');
      return;
    }

    this.ws.addEventListener('open', () => {
      this.retry = 0;
      this.handlers.onStatus?.('online');
      this.handlers.onOpen?.();
    });

    this.ws.addEventListener('message', (e) => {
      let payload;
      try {
        payload = JSON.parse(e.data);
      } catch {
        return;
      }
      this.handlers.onMessage?.(payload);
    });

    this.ws.addEventListener('close', () => {
      this.handlers.onStatus?.('offline');
      this.handlers.onClose?.();
      if (this.manualClose) return;
      this.retry = Math.min(this.retry + 1, 6);
      setTimeout(() => this.connect(), 500 * 2 ** (this.retry - 1));
    });

    this.ws.addEventListener('error', () => {
      this.handlers.onStatus?.('error');
    });
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  close() {
    this.manualClose = true;
    this.ws?.close();
  }
}

let activeSocket = null;

export default async function chatView(host) {
  // 离开上一页时释放旧连接，避免多次进入造成连接泄漏
  activeSocket?.close();
  activeSocket = null;
  const nickInput = el('input.input', { placeholder: '你的昵称', value: localStorage.getItem('hub.nick') || store.user?.nickname || '', maxlength: '20' });

  const log = el('div.chat-log');
  const statusDot = el('span.online-dot');
  const statusText = el('span.small.muted', {}, '连接中…');
  const onlineText = el('span.small.muted', {}, '');
  const input = el('input.input', { placeholder: '说点什么…（Enter 发送）', 'aria-label': '消息输入' });

  const shell = el('div.chat-shell', {}, [
    el('div.row-between.wrap', { style: { padding: '12px 16px', borderBottom: '1px solid var(--border)' } }, [
      el('div.row', {}, [statusDot, el('strong', {}, '大厅'), onlineText]),
      el('div.row', {}, [
        el('button.btn.btn-ghost.btn-sm', { type: 'button', id: 'chat-help' }, '/help 指令'),
        el('button.btn.btn-ghost.btn-sm', { type: 'button', id: 'chat-clear' }, '清屏'),
      ]),
    ]),
    log,
    el('div.chat-input', {}, [
      store.user ? el('span', { title: store.user.username }, avatar(store.user, 'sm')) : el('span', {}, '👤'),
      nickInput,
      input,
      el('button.btn.btn-primary', { type: 'button', id: 'chat-send' }, '发送'),
    ]),
  ]);

  host.append(
    el('div.page-head', {}, [
      el('h1', {}, '实时聊天室'),
      el('p', {}, '服务端手写 WebSocket 实现（RFC 6455），消息持久化到 SQLite，刷新不丢消息。'),
    ]),
    el('div.card', { style: { padding: '0', overflow: 'hidden' } }, shell),
    el('div.card.card-flat', { style: { marginTop: '16px' } }, [
      el('div.card-title', {}, '关于这个聊天室'),
      el('ul', { style: { margin: '0', paddingLeft: '20px', color: 'var(--text-soft)', fontSize: '0.9rem' } }, [
        el('li', {}, '无需依赖库：握手、帧编解码、SHA1 校验全部手写'),
        el('li', {}, '内置心跳 ping/pong，30 秒无响应自动断开'),
        el('li', {}, '支持指令：/help /who /time /me'),
        el('li', {}, '断线自动重连（指数退避，最长 30 秒）'),
        el('li', {}, '登录后消息显示为已认证身份，游客可用昵称发言'),
      ]),
    ]),
  );

  log.append(el('div.empty', { style: { padding: '40px' } }, [el('p.muted', {}, '正在连接聊天室…')]));

  const socket = new ChatSocket({
    onStatus(status) {
      statusDot.className = `online-dot${status === 'online' ? '' : ' off'}`;
      statusText.textContent = { online: '已连接', offline: '重连中…', error: '连接失败' }[status] || status;
    },
    onOpen() {
      log.replaceChildren();
      input.focus();
    },
    onMessage(payload) {
      if (payload.type === 'ready') {
        onlineText.textContent = `· 在线 ${payload.online} 人`;
        for (const msg of payload.messages) appendMessage(msg, false);
        scrollBottom();
        if (!store.user && !localStorage.getItem('hub.nick')) {
          toast.info('设置一个昵称即可参与聊天');
        }
        return;
      }
      if (payload.type === 'message') {
        appendMessage(payload.message, payload.message.nickname === (store.user?.nickname || nickInput.value));
        scrollBottom();
        return;
      }
      if (payload.type === 'presence') {
        onlineText.textContent = `· 在线 ${payload.online} 人`;
        if (payload.joined) appendSystem(`${payload.joined} 加入了聊天室`);
        if (payload.left) appendSystem(`${payload.left} 离开了聊天室`);
        scrollBottom();
        return;
      }
      if (payload.type === 'error') {
        appendSystem(payload.message);
      }
    },
  });

  function scrollBottom() {
    log.scrollTop = log.scrollHeight;
  }

  function appendMessage(msg, isMe) {
    log.querySelector('.empty')?.remove();
    const mine = msg.isMe ?? isMe;
    const node = el(`div.msg${mine ? '.me' : ''}`, {}, [
      el('div', {}, [
        el('div.who', {}, msg.kind === 'system' ? '系统' : msg.nickname),
        el('div.bubble', {}, msg.body),
      ]),
    ]);
    node.title = new Date(msg.createdAt).toLocaleString('zh-CN');
    log.append(node);
    while (log.children.length > 300) log.firstElementChild.remove();
  }

  function appendSystem(text) {
    log.querySelector('.empty')?.remove();
    log.append(el('div.msg.system', {}, el('div.bubble', {}, text)));
  }

  function send() {
    const body = input.value.trim();
    if (!body) return;
    if (!store.user) {
      const nick = nickInput.value.trim();
      if (!nick) {
        toast.warning('请先填写昵称');
        nickInput.focus();
        return;
      }
      localStorage.setItem('hub.nick', nick);
    }
    if (!socket.send({ type: 'chat', body })) {
      toast.warning('尚未连接到服务器');
      return;
    }
    input.value = '';
  }

  host.querySelector('#chat-send').addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  host.querySelector('#chat-clear').addEventListener('click', () => log.replaceChildren());
  host.querySelector('#chat-help').addEventListener('click', () => {
    input.value = '/help';
    input.focus();
  });

  on('user', () => {
    nickInput.value = store.user?.nickname || localStorage.getItem('hub.nick') || '';
  });

  // 离开页面前不主动关闭，保持单连接复用
  window.addEventListener('pagehide', () => activeSocket?.close(), { once: true });
  activeSocket = socket;
}
