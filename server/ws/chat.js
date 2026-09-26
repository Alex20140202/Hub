import { attachWebSocket } from './websocket.js';
import * as messages from '../models/messages.js';
import { findById } from '../models/users.js';
import { parseCookiesSafe } from '../http/body.js';
import { verify } from '../lib/jwt.js';
import { sessionActive } from '../lib/session.js';
import config from '../config.js';
import logger from '../lib/logger.js';

const RATE = { windowMs: 5000, max: 8 };
const log = (...args) => logger.info('[chat]', ...args);

export function setupChat(server) {
  // onReady 会同步替换为 attachWebSocket 内部维护的真实连接集合
  let clients = new Set();

  const broadcast = (payload, room = 'lobby') => {
    const text = JSON.stringify(payload);
    for (const c of clients) {
      if (c.data.room !== room) continue;
      c.send(text);
    }
  };

  /** 聊天消息需要按接收者区分 isMe，因此逐连接塑形后单独下发 */
  const broadcastMessage = (row, room = 'lobby') => {
    for (const c of clients) {
      if (c.data.room !== room) continue;
      c.send(JSON.stringify({ type: 'message', message: messages.shapeMessage(row, c.data.user?.id || null) }));
    }
  };

  const system = (text, room = 'lobby') => {
    const row = messages.add({ room, nickname: '系统', body: text, kind: 'system' });
    broadcastMessage(row, room);
  };

  attachWebSocket(server, {
    path: '/ws',
    onReady: (set) => {
      clients = set;
    },
    onConnection(conn) {
      // 身份识别：token 优先，其次昵称
      const header = String(conn.req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
      const token = conn.query.get('token') || header || parseCookiesSafe(conn.req)[config.auth.cookie];
      const payload = token && sessionActive(verify(token)?.sid) ? verify(token) : null;
      const user = payload ? findById(payload.sub) : null;
      conn.data.user = user;
      conn.data.nickname = user
        ? user.nickname || user.username
        : conn.query.get('nick') || `游客-${String(conn.socket.remotePort || 0).slice(-4)}`;

      conn.sendJSON({
        type: 'ready',
        you: { id: user?.id || null, nickname: conn.data.nickname, authenticated: !!user },
        online: clients.size,
        messages: messages.history('lobby', user?.id || null, 40),
      });
      broadcast({ type: 'presence', online: clients.size, joined: conn.data.nickname });

      let hits = [];

      conn.on('message', (text) => {
        let payloadIn;
        try {
          payloadIn = JSON.parse(text);
        } catch {
          return;
        }
        if (payloadIn.type !== 'chat') return;
        const body = String(payloadIn.body || '').trim();
        if (!body) return;

        const now = Date.now();
        hits = hits.filter((t) => now - t < RATE.windowMs);
        if (hits.length >= RATE.max) {
          conn.sendJSON({ type: 'error', message: '发送太快了，歇一会儿' });
          return;
        }
        hits.push(now);

        if (body.startsWith('/')) {
          const reply = messages.runCommand(body, { ...conn.data, online: clients.size });
          if (reply) {
            broadcastMessage(messages.add({ room: 'lobby', nickname: '系统', body: reply, kind: 'system' }));
            return;
          }
        }

        const row = messages.add({
          room: 'lobby',
          userId: conn.data.user?.id || null,
          nickname: conn.data.nickname,
          body,
          kind: 'chat',
        });
        broadcastMessage(row);
      });

      conn.on('close', () => {
        const left = conn.data.nickname;
        const online = Math.max(0, clients.size - 1);
        queueMicrotask(() => {
          broadcast({ type: 'presence', online, left });
        });
        log(`连接关闭，剩余 ${online}`);
      });
    },
  });

  log('聊天室已就绪：ws://<host>/ws');
  return clients;
}
