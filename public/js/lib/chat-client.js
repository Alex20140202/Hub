/**
 * 聊天室 WebSocket 客户端。
 * 职责边界：只管连接、协议、重连与离线队列，不碰 DOM，视图层通过事件订阅消费。
 */
import { token } from './api.js';

const DRAFT_KEY = 'hub.chat.draft';
const NICK_KEY = 'hub.nick';
const GID_KEY = 'hub.gid';
const MAX_QUEUE = 30;
const MAX_BACKOFF = 15_000;
const PING_INTERVAL = 20_000;

/**
 * 访客标识。
 * 服务端用它做稳定身份：只用昵称的话，两个同名游客会共享 actor，
 * 从而可以互相「编辑/删除」对方的消息。随机串存在本地，刷新与重连都保持不变。
 */
export function guestId() {
  try {
    let id = localStorage.getItem(GID_KEY);
    // 服务端要求 8~40 位 [A-Za-z0-9_-]
    if (!id || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) {
      const rand = crypto.getRandomValues(new Uint8Array(12));
      id = Array.from(rand, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
      localStorage.setItem(GID_KEY, id);
    }
    return id;
  } catch {
    // 隐私模式：无持久化身份，游客消息归属按昵称降级
    return '';
  }
}

export function resetGuestId() {
  try {
    localStorage.removeItem(GID_KEY);
  } catch {
    /* ignore */
  }
}

/** 读取草稿：按房间分别保存 */
export function loadDraft(room) {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    return typeof all[room] === 'string' ? all[room] : '';
  } catch {
    return '';
  }
}

export function saveDraft(room, text) {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    if (text) all[room] = text;
    else delete all[room];
    localStorage.setItem(DRAFT_KEY, JSON.stringify(all));
  } catch {
    /* 隐私模式下 localStorage 可能不可用 */
  }
}

export function clearDrafts() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export class ChatClient extends EventTarget {
  constructor({ room = 'lobby', nick = '' } = {}) {
    super();
    this.room = room;
    this.nick = nick || localStorage.getItem(NICK_KEY) || '';
    this.ws = null;
    this.status = 'idle';
    this.retry = 0;
    this.manualClose = false;
    this.queue = [];
    /** clientId -> 待确认的乐观消息，视图层据此把临时节点转正或标红 */
    this.pending = new Map();
    this.you = null;
    this.rooms = [];
    this.limits = { bodyMax: 2000, reactions: [] };
    this.commands = [];
    this.muted = null;
    this.latency = null;
    this._seq = 0;
    this._pingTimer = null;
    this._retryTimer = null;
    this._lastPingAt = 0;
    this._lastTypingSent = 0;
    this._stopped = false;
    /** 连接代次：旧 socket 的迟到事件必须忽略，否则会重复重连 */
    this._gen = 0;
    this.guestId = guestId();
  }

  connect() {
    this._clearRetry();
    this.manualClose = false;
    this._stopped = false;
    // 重复调用 connect() 时先断开旧连接，避免同一客户端开两条 socket
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) {
      this._gen++;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    const gen = ++this._gen;
    const stale = () => gen !== this._gen;

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const params = new URLSearchParams({ t: String(Date.now()) });
    const t = token.get();
    if (t) params.set('token', t);
    if (this.nick) params.set('nick', this.nick);
    if (this.room) params.set('room', this.room);
    if (!t && this.guestId) params.set('gid', this.guestId);

    this._setStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws?${params}`);
    } catch {
      this._setStatus('error');
      this._scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (stale()) return;
      this.retry = 0;
      this._setStatus('online');
      this._startPing();
      this._flush();
      this._emit('open');
    });

    ws.addEventListener('message', (e) => {
      if (stale()) return;
      let payload;
      try {
        payload = JSON.parse(e.data);
      } catch {
        return;
      }
      this._handle(payload);
    });

    ws.addEventListener('close', (e) => {
      if (stale()) return;
      this._stopPing();
      if (this.status !== 'online') this._setStatus('offline');
      else this._setStatus('reconnecting');
      this._emit('close', { code: e.code, reason: e.reason, willRetry: !this.manualClose && !this._stopped });
      if (this.manualClose || this._stopped) {
        this._setStatus('closed');
        return;
      }
      this._scheduleRetry();
    });

    ws.addEventListener('error', () => {
      // close 事件紧随其后，重连逻辑统一在那里处理
      if (stale()) return;
      if (this.status === 'connecting') this._setStatus('error');
    });
  }

  _handle(payload) {
    switch (payload.type) {
      case 'ready':
        this.you = payload.you;
        this.rooms = payload.rooms || [];
        this.limits = payload.limits || this.limits;
        this.commands = payload.commands || [];
        this.muted = payload.muted || null;
        this.room = payload.room || this.room;
        // 服务端会补发期间错过的消息，pending 里的乐观消息按 id 兜底
        this._reconcile(payload.messages?.items || []);
        this._emit('ready', payload);
        return;
      case 'joined':
        this.room = payload.room;
        this.rooms = payload.rooms || this.rooms;
        this._reconcile(payload.messages?.items || []);
        this._emit('joined', payload);
        return;
      case 'rooms':
        this.rooms = payload.rooms || this.rooms;
        this._emit('rooms', payload);
        return;
      case 'message':
        this._settle(payload.clientId, payload.message);
        this._emit('message', payload);
        return;
      case 'history':
        this._emit('history', payload);
        return;
      case 'pong':
        this.latency = Date.now() - this._lastPingAt;
        return;
      case 'muted':
        this.muted = payload.status;
        this._emit('muted', payload);
        return;
      case 'error':
        // 带 clientId 说明是某条消息被拒，视图层据此回滚乐观气泡
        if (payload.clientId) this._reject(payload.clientId, payload);
        this._emit('error', payload);
        return;
      default:
        this._emit(payload.type, payload);
    }
  }

  /**
   * 重连后服务端会补发期间错过的历史。若其中已有同一条，说明乐观消息已落库。
   * 只按 body+nickname 匹配会误判（同文连发），所以先按 room 对齐，
   * 再按「未确认消息的最早一条」顺序配对，尽量让气泡落位正确。
   */
  _reconcile(items) {
    if (!this.pending.size) return;
    const byRoom = new Map();
    for (const m of items) {
      if (!byRoom.has(m.room)) byRoom.set(m.room, []);
      byRoom.get(m.room).push(m);
    }
    const waiting = [...this.pending.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [clientId, meta] of waiting) {
      const pool = byRoom.get(meta.room) || [];
      const idx = pool.findIndex((m) => m.body === meta.body && m.nickname === this.you?.nickname);
      if (idx < 0) continue;
      const [hit] = pool.splice(idx, 1);
      this._settle(clientId, hit);
    }
  }

  _settle(clientId, message) {
    if (!clientId) return;
    const meta = this.pending.get(clientId);
    if (!meta) return;
    this.pending.delete(clientId);
    this._emit('settle', { clientId, message, meta });
  }

  _reject(clientId, payload) {
    const meta = this.pending.get(clientId);
    if (!meta) return;
    this.pending.delete(clientId);
    this._emit('reject', { clientId, payload, meta });
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this._emit('status', { status, retry: this.retry });
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  on(type, handler) {
    const wrapped = (e) => handler(e.detail, e);
    this.addEventListener(type, wrapped);
    return () => this.removeEventListener(type, wrapped);
  }

  /* ---------- 发送 ---------- */

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * 发送聊天消息。未连接时进离线队列，重连后按序补发。
   * @returns {{clientId: string, queued: boolean}|null}
   */
  send(body, { replyTo = null } = {}) {
    const text = String(body ?? '').trim();
    if (!text) return null;
    if (this.muted) {
      this._emit('error', { code: 'muted', message: this.muted.permanent ? '你已被禁言' : '你已被禁言' });
      return null;
    }
    const clientId = `c${Date.now().toString(36)}${(this._seq++).toString(36)}`;
    const frame = { type: 'chat', body: text, clientId, room: this.room };
    if (replyTo) frame.replyTo = replyTo;

    if (!this.connected) {
      if (this.queue.length >= MAX_QUEUE) this.queue.shift();
      this.queue.push(frame);
      this._emit('queued', { clientId, frame, size: this.queue.length });
      return { clientId, queued: true };
    }
    this.pending.set(clientId, { body: text, room: this.room, replyTo, at: Date.now() });
    this.ws.send(JSON.stringify(frame));
    this._emit('sent', { clientId, frame });
    return { clientId, queued: false };
  }

  _flush() {
    const pending = this.queue;
    this.queue = [];
    for (const frame of pending) {
      this.pending.set(frame.clientId, { body: frame.body, room: frame.room, replyTo: frame.replyTo, at: Date.now() });
      this.ws.send(JSON.stringify(frame));
    }
    if (pending.length) this._emit('flushed', { count: pending.length });
  }

  _raw(frame) {
    if (this.connected) {
      this.ws.send(JSON.stringify(frame));
      return true;
    }
    return false;
  }

  /* ---------- 动作 ---------- */

  join(room) {
    if (room === this.room) return;
    this.room = room;
    return this._raw({ type: 'join', room });
  }

  loadMore(room, before) {
    return this._raw({ type: 'load', room: room || this.room, before });
  }

  edit(id, body) {
    return this._raw({ type: 'edit', id, body });
  }

  remove(id) {
    return this._raw({ type: 'delete', id });
  }

  react(id, emoji) {
    return this._raw({ type: 'react', id, emoji });
  }

  markRead(room, at) {
    return this._raw({ type: 'read', room: room || this.room, at: at || new Date().toISOString() });
  }

  setNickname(nick) {
    this.nick = nick;
    if (nick) localStorage.setItem(NICK_KEY, nick);
    return this._raw({ type: 'nick', nick });
  }

  /** 输入中：前端节流，服务端还会再限一次 */
  typing() {
    if (this._lastTypingSent && Date.now() - this._lastTypingSent < 1500) return;
    this._lastTypingSent = Date.now();
    this._raw({ type: 'typing', room: this.room });
  }

  stopTyping() {
    this._lastTypingSent = 0;
    this._raw({ type: 'stopTyping', room: this.room });
  }

  /* ---------- 心跳与重连 ---------- */

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (!this.connected) return;
      this._lastPingAt = Date.now();
      this._raw({ type: 'ping', at: this._lastPingAt });
    }, PING_INTERVAL);
  }

  _stopPing() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
  }

  _clearRetry() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._retryTimer = null;
  }

  _scheduleRetry() {
    this._clearRetry();
    this.retry = Math.min(this.retry + 1, 8);
    // 指数退避 + 抖动，避免服务端恢复时所有客户端同时涌入
    const base = Math.min(500 * 2 ** (this.retry - 1), MAX_BACKOFF);
    const delay = base * (0.7 + Math.random() * 0.6);
    this._retryTimer = setTimeout(() => this.connect(), delay);
    this._emit('retry', { attempt: this.retry, delay: Math.round(delay) });
  }

  /** 手动立即重连：代次自增让旧 socket 的 close 事件失效，避免同时排两次重连 */
  reconnectNow() {
    this._stopped = false;
    this.manualClose = false;
    this.retry = 0;
    this._clearRetry();
    this._gen++;
    this._stopPing();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.connect();
  }

  close() {
    this._stopped = true;
    this.manualClose = true;
    this._clearRetry();
    this._gen++;
    this._stopPing();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
