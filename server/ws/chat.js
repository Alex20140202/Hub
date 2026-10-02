import { acceptKey, encodeFrame, encodeClose, createDecoder, newClientId, OP } from './websocket.js';
import { verifySessionToken, readToken } from '../lib/session.js';
import { parseCookies } from '../http/body.js';
import { createLimiter } from '../lib/rate-limit.js';
import { addMessage, listMessages, messageCount } from '../models/chat.js';
import * as users from '../models/users.js';
import { logger } from '../lib/logger.js';

/** 聊天室：lobby 主厅 + 按用户 id 开的私有房间。 */
const rooms = new Map();
const sendLimiter = createLimiter({ windowMs: 5000, max: 8, name: 'chat-send' });

const room = (name) => {
  if (!rooms.has(name)) rooms.set(name, new Set());
  return rooms.get(name);
};

const onlineCount = () => [...rooms.values()].reduce((sum, set) => sum + set.size, 0);

function send(client, payload) {
  if (client.socket.destroyed) return;
  client.socket.write(encodeFrame(JSON.stringify(payload)));
}

function broadcast(name, payload, { except = null } = {}) {
  for (const client of room(name)) {
    if (client !== except) send(client, payload);
  }
}

/** 处理客户端消息：普通聊天与 /help、/who、/time、/me 指令。 */
function handleCommand(client, text) {
  const trimmed = text.trim();
  const isMe = trimmed.startsWith('/me ');
  if (!isMe && trimmed.startsWith('/')) {
    const [command, ...rest] = trimmed.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    switch (command) {
      case 'help':
        return system(client, '可用指令：/help 帮助 · /who 在线人数 · /time 服务器时间 · /me 动作');
      case 'who':
        return system(client, `当前在线 ${onlineCount()} 人`);
      case 'time':
        return system(client, `服务器时间 ${new Date().toLocaleString('zh-CN')}`);
      case 'me':
        if (!arg) return system(client, '用法：/me 微笑');
        break;
      default:
        return system(client, `未知指令 /${command}，输入 /help 查看可用指令`);
    }
  }
  return null;
}

function system(client, body) {
  send(client, { type: 'message', message: addMessage({ room: client.room, userId: null, nickname: '系统', kind: 'system', body }) });
  return true;
}

function onMessage(client, text) {
  if (typeof text !== 'string' || !text.trim()) return;
  if (sendLimiter.take(client.id)) {
    send(client, { type: 'error', message: '发送太快了，歇一会儿' });
    return;
  }

  if (client.room === 'lobby') {
    const handled = handleCommand(client, text);
    if (handled) return;
  }

  const kind = text.trim().startsWith('/me ') ? 'action' : 'chat';
  const body = kind === 'action' ? text.trim().slice(4) : text.trim().slice(0, 2000);
  const message = addMessage({ room: client.room, userId: client.userId, nickname: client.nickname, kind, body });
  broadcast(client.room, { type: 'message', message });
}

/** 升级握手并接管连接。 */
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

  // 允许前端用 ?token= 或 Authorization 头携带令牌
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
    room: 'lobby',
  };

  // 私有房间：/ws?room=<userId>，仅本人可进
  const requested = url.searchParams.get('room');
  if (requested && String(user?.id) === String(requested)) client.room = `u${user.id}`;

  room(client.room).add(client);
  logger.debug(`[chat] ${client.nickname} 进入 ${client.room}（在线 ${onlineCount()}）`);

  send(client, {
    type: 'ready',
    you: { id: client.id, nickname: client.nickname, authenticated: Boolean(user), room: client.room },
    online: onlineCount(),
    total: messageCount(client.room),
    messages: listMessages(client.room, { limit: 50 }),
  });
  broadcast(client.room, { type: 'presence', online: onlineCount(), joined: client.nickname }, { except: client });

  const decode = createDecoder({
    onMessage: (text) => onMessage(client, text),
    onPing: (payload) => socket.write(encodeFrame(payload, OP.PONG)),
    onClose: () => close(),
    onError: (error) => {
      send(client, { type: 'error', message: error.message });
      close();
    },
  });

  const close = () => {
    if (client.closed) return;
    client.closed = true;
    room(client.room).delete(client);
    try {
      socket.write(encodeClose());
    } catch {
      /* socket 可能已断开 */
    }
    socket.end();
    broadcast(client.room, { type: 'presence', online: onlineCount(), left: client.nickname });
    logger.debug(`[chat] ${client.nickname} 离开 ${client.room}（在线 ${onlineCount()}）`);
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

export const chatStats = () => ({ online: onlineCount(), rooms: rooms.size, messages: messageCount('lobby') });
export const broadcastSystem = (body) => broadcast('lobby', { type: 'message', message: addMessage({ nickname: '系统', kind: 'system', body }) });

/** 向某个房间广播任意负载（积分通知、系统公告等）。 */
export const pushToRoom = (name, payload) => {
  const set = rooms.get(name);
  if (!set?.size) return 0;
  for (const client of set) send(client, payload);
  return set.size;
};
