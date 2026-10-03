import { acceptKey, encodeFrame, encodeClose, createDecoder, newClientId, OP } from './websocket.js';
import { verifySessionToken, readToken } from '../lib/session.js';
import { parseCookies } from '../http/body.js';
import { createLimiter } from '../lib/rate-limit.js';
import { addMessage, listMessages, messageCount, deleteMessage, messageAuthor, markRead, pinnedMessage } from '../models/chat.js';
import { getFile } from '../models/files.js';
import * as users from '../models/users.js';
import * as rooms from '../models/rooms.js';
import { logger } from '../lib/logger.js';

/**
 * 聊天室：一个连接可以同时加入多个房间（大厅 + 若干群 + 若干私聊）。
 * 房间可见性与发消息权限统一走 models/rooms.js，避免两套规则。
 */
const clients = new Set();
const sendLimiter = createLimiter({ windowMs: 5000, max: 8, name: 'chat-send' });

const send = (client, payload) => {
  if (client.socket.destroyed) return;
  client.socket.write(encodeFrame(JSON.stringify(payload)));
};

const fail = (client, message) => send(client, { type: 'error', message });

/** 在线人数按房间分别统计；大厅人数是全站在线总量。 */
const onlineIn = (code) => {
  let count = 0;
  for (const client of clients) if (client.rooms.has(code)) count += 1;
  return count;
};

const onlineTotal = () => new Set([...clients].map((client) => client.id)).size;

function broadcast(code, payload, { except = null } = {}) {
  for (const client of clients) {
    if (client.rooms.has(code) && client !== except) send(client, payload);
  }
}

const presencePayload = (code) => ({ type: 'presence', room: code, online: onlineIn(code), total: onlineTotal() });

/* --------------------------------- 权限 --------------------------------- */

const canSee = (code, userId) => rooms.accessOf(code, userId);

/** 发言权限：大厅任何人，私密群与私聊必须是成员。 */
const canPost = (code, userId) => {
  if (code === 'lobby') return true;
  if (!rooms.roomExists(code)) return '房间不存在';
  if (!userId) return '请先登录后发言';
  if (rooms.isMember(code, userId)) return true;
  const room = rooms.getRoomByCode(code);
  return room?.isPublic ? '请先加入该房间' : '你不是该房间成员';
};

/* --------------------------------- 指令 --------------------------------- */

const pinnedOf = (code) => pinnedMessage(code);

/** 房间历史 + 是否还有更早的消息（客户端据此决定要不要显示「加载更早」）。 */
const HISTORY_LIMIT = 50;
function historyPayload(code) {
  const messages = listMessages(code, { limit: HISTORY_LIMIT });
  return {
    messages,
    hasMore: messageCount(code) > messages.length,
  };
}

const COMMANDS = {
  help: () => '可用指令：/help 帮助 · /who 在线人数 · /time 服务器时间 · /me 动作',
  who: (code) => `「${code}」当前在线 ${onlineIn(code)} 人，全站在线 ${onlineTotal()} 人`,
  time: () => `服务器时间 ${new Date().toLocaleString('zh-CN')}`,
};

/* --------------------------------- 处理 --------------------------------- */

function handleMessage(client, text, { replyTo = null } = {}) {
  const code = client.activeRoom;
  if (!code) return fail(client, '请先进入一个房间');

  if (client.userId && sendLimiter.take(client.id)) return fail(client, '发送太快了，歇一会儿');

  const trimmed = text.trim();
  const allowed = canPost(code, client.userId);
  if (allowed !== true) return fail(client, allowed);

  // 指令（私聊里也可用）
  if (trimmed.startsWith('/') && !trimmed.startsWith('/me ')) {
    const [name, ...rest] = trimmed.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    if (COMMANDS[name]) {
      const body = COMMANDS[name](code, arg);
      broadcast(code, { type: 'message', room: code, message: addMessage({ room: code, userId: null, nickname: '系统', kind: 'system', body }) });
      return;
    }
    if (name !== 'me') {
      return broadcast(code, {
        type: 'message',
        room: code,
        message: addMessage({ room: code, userId: null, nickname: '系统', kind: 'system', body: `未知指令 /${name}，输入 /help 查看` }),
      });
    }
  }

  const kind = trimmed.startsWith('/me ') ? 'action' : 'chat';
  const body = kind === 'action' ? trimmed.slice(4) : trimmed.slice(0, 2000);
  const message = addMessage({ room: code, userId: client.userId, nickname: client.nickname, kind, body, replyTo });
  broadcast(code, { type: 'message', room: code, message });
}

/** 发送聊天附件：必须已上传到自己的文件里，且文件归属本人。 */
function handleAttachment(client, fileId) {
  const code = client.activeRoom;
  if (!code) return fail(client, '请先进入一个房间');
  if (!client.userId) return fail(client, '请先登录后再发送文件');

  const allowed = canPost(code, client.userId);
  if (allowed !== true) return fail(client, allowed);

  const file = getFile(Number(fileId), client.userId);
  if (!file) return fail(client, '文件不存在或不属于你');

  const message = addMessage({
    room: code,
    userId: client.userId,
    nickname: client.nickname,
    kind: 'file',
    body: file.name,
    attachmentId: file.id,
  });
  broadcast(code, { type: 'message', room: code, message });
}

function handleCommand(client, payload) {
  const type = payload?.type;

  if (type === 'chat') {
    return handleMessage(client, String(payload.body ?? ''), {
      replyTo: payload.replyTo ?? payload.replyToId ?? null,
    });
  }

  // 已读回执：只对同房间成员生效
  if (type === 'seen') {
    const code = String(payload.room ?? client.activeRoom ?? 'lobby');
    if (!client.userId || !rooms.isMember(code, client.userId)) return;
    const ids = (Array.isArray(payload.messageIds) ? payload.messageIds : [payload.messageId])
      .map(Number)
      .filter(Number.isFinite);
    if (!ids.length) return;
    for (const messageId of ids) markRead(messageId, client.userId);
    broadcast(code, { type: 'seen', room: code, readerId: client.userId, messageIds: ids });
    return;
  }

  if (type === 'attach') return handleAttachment(client, payload.fileId);

  if (type === 'join') {
    const code = String(payload.room ?? 'lobby');
    const visible = canSee(code, client.userId);
    if (visible !== true) return fail(client, visible);

    client.rooms.add(code);
    // join 即切换：用户点哪个房间就该看哪个；重连时靠后面的 switch 兜底
    client.activeRoom = code;

    if (client.userId) rooms.markRead(code, client.userId);
    send(client, {
      type: 'room',
      room: code,
      online: onlineIn(code),
      pinned: pinnedOf(code),
      muted: client.userId ? rooms.isMuted(code, client.userId) : false,
      ...historyPayload(code),
    });
    broadcast(code, presencePayload(code), { except: client });
    return;
  }

  if (type === 'leave') {
    const code = String(payload.room ?? '');
    if (code === 'lobby') return fail(client, '不能离开大厅');
    if (!client.rooms.has(code)) return;
    client.rooms.delete(code);
    if (client.activeRoom === code) client.activeRoom = [...client.rooms][0] ?? 'lobby';
    broadcast(code, presencePayload(code));
    send(client, { type: 'left', room: code, active: client.activeRoom });
    return;
  }

  if (type === 'switch') {
    const code = String(payload.room ?? '');
    if (!client.rooms.has(code)) return fail(client, '尚未加入该房间');
    client.activeRoom = code;
    if (client.userId) rooms.markRead(code, client.userId);
    send(client, {
      type: 'room',
      room: code,
      online: onlineIn(code),
      pinned: pinnedOf(code),
      muted: client.userId ? rooms.isMuted(code, client.userId) : false,
      ...historyPayload(code),
    });
    return;
  }

  if (type === 'read') {
    rooms.markRead(String(payload.room ?? ''), client.userId);
    return;
  }

  if (type === 'delete') {
    const id = Number(payload.messageId);
    const record = Number.isFinite(id) ? messageAuthor(id) : null;
    const allowed = record && (record.userId === client.userId || client.role === 'admin');
    if (allowed && deleteMessage(id)) {
      broadcast(record.room, { type: 'deleted', room: record.room, messageId: id });
      // 撤掉的正是公告时，顺带把置顶状态同步给房间
      if (record.pinned) broadcast(record.room, { type: 'pinned', room: record.room, pinned: null });
    } else {
      fail(client, '只能删除自己的消息');
    }
    return;
  }

  return fail(client, `未知指令：${type}`);
}

/* --------------------------------- 升级 --------------------------------- */

export function handleUpgrade(req, socket, head) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    return;
  }

  const accept = acceptKey(req.headers['sec-websocket-key']);
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !accept) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = url.searchParams.get('token') || readToken(req.headers, cookies);
  const claims = token ? verifySessionToken(token) : null;
  const user = claims ? users.findById(claims.userId) : null;

  socket.setNoDelay(true);
  socket.write(
    ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '\r\n'].join('\r\n'),
  );

  const client = {
    id: newClientId(),
    socket,
    userId: user?.id ?? null,
    nickname: user?.nickname ?? `游客-${newClientId().slice(0, 4)}`,
    role: user?.role ?? 'guest',
    rooms: new Set(['lobby']),
    activeRoom: 'lobby',
    closed: false,
  };
  clients.add(client);
  logger.debug(`[chat] ${client.nickname} 连接（在线 ${onlineTotal()}）`);

  send(client, {
    type: 'ready',
    you: { id: client.id, nickname: client.nickname, authenticated: Boolean(user), role: client.role },
    online: onlineIn('lobby'),
    total: onlineTotal(),
    pinned: pinnedOf('lobby'),
    muted: false,
    ...historyPayload('lobby'),
  });
  broadcast('lobby', presencePayload('lobby'), { except: client });

  const decode = createDecoder({
    onMessage: (text) => {
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        return fail(client, '消息格式错误');
      }
      handleCommand(client, payload);
    },
    onPing: (payload) => socket.write(encodeFrame(payload, OP.PONG)),
    onClose: () => close(),
    onError: (error) => {
      fail(client, error.message);
      close();
    },
  });

  const close = () => {
    if (client.closed) return;
    client.closed = true;
    clients.delete(client);
    try {
      socket.write(encodeClose());
    } catch {
      /* socket 可能已断开 */
    }
    socket.end();
    for (const code of client.rooms) broadcast(code, presencePayload(code));
    logger.debug(`[chat] ${client.nickname} 断开（在线 ${onlineTotal()}）`);
  };

  socket.on('data', (chunk) => {
    try {
      decode(chunk);
    } catch (error) {
      logger.warn('[chat] 帧解析失败:', error.message);
      close();
    }
  });
  socket.on('error', close);
  socket.on('close', close);
  if (head?.length) decode(head);
}

/** 首页/聊天室用的在线概览。 */
export const chatStats = () => ({ online: onlineTotal(), messages: messageCount('lobby') });
export const broadcastSystem = (body) => broadcast('lobby', { type: 'message', room: 'lobby', message: addMessage({ nickname: '系统', kind: 'system', body }) });
export const broadcastToRoom = (code, payload) => broadcast(code, payload);
export const pushToRoom = (code, payload) => broadcast(code, payload);
