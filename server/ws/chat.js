import { attachWebSocket } from './websocket.js';
import * as messages from '../models/messages.js';
import * as chat from '../models/chat.js';
import { findById } from '../models/users.js';
import { parseCookiesSafe } from '../http/body.js';
import { verify } from '../lib/jwt.js';
import { sessionActive } from '../lib/session.js';
import * as points from '../models/points.js';
import config from '../config.js';
import logger from '../lib/logger.js';

const C = config.chat;
const log = (...args) => logger.info('[chat]', ...args);
const TYPING_TTL = 4000;
const TYPING_THROTTLE = 1500;

/**
 * 跨连接共享的滑动窗口限流。
 * 之前限流状态挂在 conn 上，重连即清零，形同虚设；这里按 actor 存到服务端。
 */
class RateLimiter {
  constructor(windowMs, max) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
    this.sweeper = setInterval(() => this.sweep(), Math.max(windowMs * 4, 30_000));
    this.sweeper.unref?.();
  }

  /** @returns {{ok: boolean, retryAfterMs: number}} */
  take(key, now = Date.now()) {
    let list = this.hits.get(key);
    if (!list) {
      list = [];
      this.hits.set(key, list);
    }
    const cutoff = now - this.windowMs;
    while (list.length && list[0] < cutoff) list.shift();
    if (list.length >= this.max) {
      return { ok: false, retryAfterMs: list[0] + this.windowMs - now };
    }
    list.push(now);
    return { ok: true, retryAfterMs: 0 };
  }

  clear(key) {
    this.hits.delete(key);
  }

  sweep() {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, list] of this.hits) {
      while (list.length && list[0] < cutoff) list.shift();
      if (!list.length) this.hits.delete(key);
    }
  }

  stop() {
    clearInterval(this.sweeper);
  }
}

export function setupChat(server) {
  // onReady 会同步替换为 attachWebSocket 内部维护的真实连接集合
  let clients = new Set();
  const limiter = new RateLimiter(C.rateWindowMs, C.rateMax);
  /** room -> Set<conn> */
  /** room -> Map<connId, {nick, at}> */
  const typing = new Map();
  /** connId -> lastTypingBroadcastAt，避免刷屏 */
  const typingSentAt = new Map();

  // 在线状态统一由模型层维护，REST 侧读的是同一份
  const roomOccupants = (room) => [...clients].filter((c) => c.data?.room === room);
  const liveCounts = chat.roomCounts;
  const onlineList = (room) => chat.onlineList(room);

  const leaveRoom = (conn) => {
    const room = conn.data?.room;
    if (!room) return;
    chat.leavePresence(conn.id);
    conn.data.room = null;
    const t = typing.get(room);
    if (t) {
      t.delete(conn.id);
      if (!t.size) typing.delete(room);
    }
  };

  const enterRoom = (conn, room) => {
    leaveRoom(conn);
    conn.data.room = room;
    chat.enterPresence(conn.id, room, conn.data.nickname, conn.data.user?.id || null);
  };

  const send = (conn, payload) => {
    // 背压：慢客户端不推送消息，避免服务端内存被撑大
    if (!conn.writable) {
      conn.close(1013, 'slow consumer');
      return false;
    }
    return conn.sendJSON(payload);
  };

  const broadcast = (payload, room = 'lobby') => {
    const text = JSON.stringify(payload);
    for (const c of roomOccupants(room)) {
      if (c.writable) c.send(text);
      else c.close(1013, 'slow consumer');
    }
  };

  /** 按接收者区分 isMe/canEdit，逐连接塑形 */
  const broadcastMessage = (row, room = 'lobby', extra = {}) => {
    for (const c of roomOccupants(room)) {
      if (!c.writable) {
        c.close(1013, 'slow consumer');
        continue;
      }
      c.sendJSON({
        type: 'message',
        room,
        message: messages.shapeMessage(row, { id: c.data.user?.id || null, role: c.data.role, actor: c.data.actor }),
        ...extra,
      });
    }
  };

  const roomListFor = (conn) => chat.listRoomsWithUnread(liveCounts(), conn.data.user?.id || null);

  /** 广播房间列表：在线人数与未读数对每个用户不同 */
  const broadcastRooms = () => {
    for (const c of clients) {
      if (!c.writable) continue;
      c.sendJSON({ type: 'rooms', rooms: roomListFor(c), current: c.data?.room || 'lobby' });
    }
  };

  const pushPresence = (room) => {
    broadcast({ type: 'presence', room, online: chat.roomCounts().get(room) || 0, onlineList: onlineList(room) }, room);
    broadcastRooms();
  };

  /** 输入中状态：4 秒未刷新自动消失 */
  const typingNames = (room, exceptId) =>
    [...(typing.get(room)?.values() || [])]
      .filter((t) => t.connId !== exceptId && Date.now() - t.at < TYPING_TTL)
      .map((t) => t.nick);

  const pushTyping = (room) => {
    broadcast({ type: 'typing', room, who: typingNames(room) }, room);
  };

  const pruneTyping = setInterval(() => {
    let dirty = false;
    for (const [room, map] of typing) {
      for (const [connId, t] of map) {
        if (Date.now() - t.at >= TYPING_TTL) {
          map.delete(connId);
          dirty = true;
        }
      }
      if (!map.size) typing.delete(room);
    }
    if (dirty) for (const room of [...typing.keys()]) pushTyping(room);
  }, 2000);
  pruneTyping.unref?.();

  /** 统一改名入口：更新身份、同步在线状态、迁移历史消息归属 */
  const applyNickname = (conn, next) => {
    const prev = conn.data.actor;
    conn.data.nickname = next;
    conn.data.actor = chat.actorKey({ userId: conn.data.user?.id || null, nickname: next });
    chat.movePresence(conn.id, conn.data.room, next, conn.data.user?.id || null);
    if (prev && prev !== conn.data.actor && !conn.data.user) {
      const moved = chat.renameActor(prev, conn.data.actor);
      if (moved) log(`昵称变更 ${prev} → ${conn.data.actor}，迁移 ${moved} 条历史消息归属`);
    }
  };

  const systemMessage = (room, text, meta = null) => {
    const row = messages.addSystem(room, text, meta);
    broadcastMessage(row, room);
    return row;
  };

  const loadHistory = (room, conn, limit, before) =>
    messages.history(room, { id: conn.data.user?.id || null, role: conn.data.role, actor: conn.data.actor }, { limit, before });

  attachWebSocket(server, {
    path: '/ws',
    maxTotal: C.maxTotal,
    maxPerIp: C.maxPerIp,
    heartbeatMs: C.heartbeatMs,
    onReady: (set) => {
      clients = set;
    },
    onConnection(conn) {
      // 身份识别：Authorization 头 > token 查询参数 > 会话 Cookie
      const header = String(conn.req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
      const token = conn.query.get('token') || header || parseCookiesSafe(conn.req)[config.auth.cookie];
      const claims = token ? verify(token) : null;
      const payload = claims && sessionActive(claims.sid) ? claims : null;
      const user = payload ? findById(payload.sub) : null;
      conn.data.user = user;
      conn.data.role = user?.role || null;
      conn.data.nickname = user
        ? user.nickname || user.username
        : chat.sanitizeNickname(conn.query.get('nick') || '', `游客-${String(conn.socket.remotePort || 0).slice(-4)}`);
      conn.data.actor = chat.actorKey({ userId: user?.id || null, nickname: conn.data.nickname });
      conn.data.typingSentAt = 0;

      const mute = chat.muteStatus(conn.data.actor);
      if (mute) {
        // 禁言用户仍可在线旁观，只是不能发言
        log(`禁言用户接入 ${conn.data.nickname}`);
      }

      const requested = conn.query.get('room');
      const room = requested && chat.roomExists(requested) ? requested : chat.SYSTEM_ROOM;
      enterRoom(conn, room);

      const history = loadHistory(room, conn, C.historyOnReady, null);

      send(conn, {
        type: 'ready',
        you: {
          id: user?.id || null,
          nickname: conn.data.nickname,
          authenticated: !!user,
          role: conn.data.role,
          avatar: user?.avatar || null,
          frame: user?.frame || null,
        },
        room,
        rooms: roomListFor(conn),
        online: chat.roomCounts().get(room) || 0,
        onlineTotal: clients.size,
        onlineList: onlineList(room),
        messages: history,
        unread: Object.fromEntries(
          chat
            .listRoomsWithUnread(liveCounts(), user?.id || null)
            .filter((r) => r.unread > 0)
            .map((r) => [r.slug, r.unread]),
        ),
        commands: messages.COMMANDS,
        limits: { bodyMax: C.bodyMax, reactions: C.reactions },
        muted: mute,
        serverTime: new Date().toISOString(),
      });

      if (mute) {
        send(conn, { type: 'error', code: 'muted', message: mute.permanent ? '你已被禁言' : `你已被禁言（剩余 ${Math.ceil((mute.remainingMs || 0) / 60000)} 分钟）` });
      }

      broadcast({ type: 'entered', room, nickname: conn.data.nickname, online: chat.roomCounts().get(room) || 0 }, room);
      pushPresence(room);
      broadcastRooms();
      log(`接入 ${conn.data.nickname}${user ? '（已登录）' : '（游客）'} → #${room}`);

      /* ---------- 指令 ---------- */

      // 按目标房间构造指令上下文，避免客户端显式传 room 时清错房间
      const buildCommandCtx = (target) => ({
        user,
        nickname: conn.data.nickname,
        actor: conn.data.actor,
        role: conn.data.role,
        room: target,
        online: chat.roomCounts().get(target) || 0,
        onlineList: onlineList(target),
        rooms: chat.listRooms(new Map(), null),
        setNickname: (next) => {
          applyNickname(conn, next);
        },
        setTopic: (topic) => {
          try {
            chat.updateRoom(target, { topic });
            broadcastRooms();
          } catch (err) {
            log(`更新主题失败：${err.message}`);
          }
        },
        clearRoom: () => {
          messages.clearRoom(target);
          for (const c of roomOccupants(target)) c.sendJSON({ type: 'cleared', room: target });
        },
        mute: (name, minutes, reason) => {
          chat.mute({ target: `g:${name}`, minutes, reason, createdBy: user?.id || null });
          for (const c of clients) {
            const status = c.data ? chat.muteStatus(c.data.actor) : null;
            if (status) c.sendJSON({ type: 'muted', status });
          }
        },
        unmute: (name) => chat.unmute(`g:${name}`),
      });

      /* ---------- 消息处理 ---------- */

      // 任何未预期的异常都必须变成错误帧：这里抛出会直接带崩整个进程
      const onFrame = (text) => {
        let inMsg;
        try {
          inMsg = JSON.parse(text);
        } catch {
          return;
        }
        if (!inMsg || typeof inMsg.type !== 'string') return;
        const now = Date.now();
        const reply = (code, message, extra = {}) => {
          send(conn, { type: 'error', code, message, clientId: inMsg.clientId || null, ...extra });
        };

        try {
          switch (inMsg.type) {
          /* 切换房间 */
          case 'join': {
            const next = String(inMsg.room || '');
            if (!chat.roomExists(next)) return reply('no_such_room', '房间不存在');
            if (next === conn.data.room) return;
            const from = conn.data.room;
            enterRoom(conn, next);
            const page = loadHistory(next, conn, C.historyOnReady, null);
            send(conn, {
              type: 'joined',
              room: next,
              messages: page,
              online: chat.roomCounts().get(next) || 0,
              onlineList: onlineList(next),
              rooms: roomListFor(conn),
            });
            broadcast({ type: 'entered', room: next, nickname: conn.data.nickname, online: chat.roomCounts().get(next) || 0 }, next);
            pushPresence(next);
            // 切房间也要通知旧房间，否则那边的在线列表会一直挂着离开的人
            if (from && from !== next) {
              broadcast(
                {
                  type: 'exited',
                  room: from,
                  nickname: conn.data.nickname,
                  online: chat.roomCounts().get(from) || 0,
                  reason: 'switch',
                },
                from,
              );
              pushPresence(from);
            }
            broadcastRooms();
            return;
          }

          /* 切换昵称（游客） */
          case 'nick': {
            if (user) return reply('forbidden', '登录后昵称跟随账号');
            const next = chat.sanitizeNickname(inMsg.nick, '');
            if (!next) return reply('invalid', '昵称不能为空');
            applyNickname(conn, next);
            send(conn, { type: 'nick', nickname: next, actor: conn.data.actor });
            pushPresence(conn.data.room);
            broadcastRooms();
            return;
          }

          /* 加载更早的历史 */
          case 'load': {
            const target = String(inMsg.room || conn.data.room);
            if (!chat.roomExists(target)) return reply('no_such_room', '房间不存在');
            const page = loadHistory(target, conn, C.pageSize, inMsg.before || null);
            send(conn, { type: 'history', room: target, ...page });
            return;
          }

          /* 标记已读 */
          case 'read': {
            if (!user) return;
            const target = String(inMsg.room || conn.data.room);
            if (!chat.roomExists(target)) return;
            chat.markRead(user.id, target, inMsg.at || new Date(now).toISOString());
            send(conn, { type: 'read', room: target, unread: 0 });
            broadcastRooms();
            return;
          }

          /* 输入中 */
          case 'typing': {
            const target = String(inMsg.room || conn.data.room);
            if (!chat.roomExists(target)) return;
            if (chat.muteStatus(conn.data.actor)) return;
            // 限流：输入中事件最频繁，单独做更严的节流
            if (now - (typingSentAt.get(conn.id) || 0) < TYPING_THROTTLE) return;
            typingSentAt.set(conn.id, now);
            if (!typing.has(target)) typing.set(target, new Map());
            typing.get(target).set(conn.id, { nick: conn.data.nickname, at: now, connId: conn.id });
            pushTyping(target);
            return;
          }

          /* 停止输入 */
          case 'stopTyping': {
            const target = String(inMsg.room || conn.data.room);
            if (typing.get(target)?.delete(conn.id)) pushTyping(target);
            return;
          }

          /* 发消息 */
          case 'chat': {
            const target = String(inMsg.room || conn.data.room);
            if (!chat.roomExists(target)) return reply('no_such_room', '房间不存在');
            const body = String(inMsg.body ?? '');
            if (!body.trim()) return reply('empty', '消息不能为空');

            const status = chat.muteStatus(conn.data.actor);
            if (status) {
              return reply(
                'muted',
                status.permanent ? '你已被禁言' : `你已被禁言，剩余 ${Math.ceil((status.remainingMs || 0) / 60000)} 分钟`,
                { status },
              );
            }

            // 跨连接限流：同一账号多开也共享额度
            const gate = limiter.take(conn.data.actor, now);
            if (!gate.ok) {
              return reply('rate_limited', `发送太快，请 ${Math.ceil(gate.retryAfterMs / 1000)} 秒后再试`, {
                retryAfterMs: gate.retryAfterMs,
              });
            }

            // 指令：/nick 会改写 conn.data.nickname，需要用最新值
            if (body.startsWith('/')) {
              const out = messages.runCommand(body, buildCommandCtx(target));
              if (out) {
                const kind = body.startsWith('/me ') ? 'action' : 'system';
                const row = messages.add({
                  room: target,
                  userId: user?.id || null,
                  nickname: kind === 'action' ? conn.data.nickname : '系统',
                  body: out,
                  kind,
                  meta: kind === 'action' ? { command: body.split(/\s+/)[0] } : null,
                  actor: conn.data.actor,
                });
                broadcastMessage(row, target, { echo: inMsg.clientId || null });
                if (kind === 'action' && user) points.earn(user.id, 'chat_message');
                return;
              }
            }

            const row = messages.add({
              room: target,
              userId: user?.id || null,
              nickname: conn.data.nickname,
              body,
              kind: 'chat',
              replyTo: inMsg.replyTo || null,
              actor: conn.data.actor,
            });
            // clientId 回传，前端用它把乐观消息转正，避免重复
            broadcastMessage(row, target, { clientId: inMsg.clientId || null });
            if (user) {
              points.earn(user.id, 'chat_message');
              // 发言者自己自动已读
              chat.markRead(user.id, target, row.created_at);
            }
            broadcastRooms();
            return;
          }

          /* 编辑 */
          case 'edit': {
            const id = String(inMsg.id || '');
            const res = messages.updateMessage(id, inMsg.body, { userId: user?.id || null, actor: conn.data.actor, role: conn.data.role });
            if (res.error) {
              const map = {
                not_found: '消息不存在',
                forbidden: '只能编辑自己的消息',
                deleted: '消息已删除',
                expired: '超过 15 分钟的消息不能编辑',
                empty: '消息不能为空',
                too_long: `消息最长 ${C.bodyMax} 字`,
              };
              return reply(res.error, map[res.error] || '编辑失败', { messageId: id });
            }
            // 编辑后的消息同样要按接收者塑形 isMe
            for (const c of roomOccupants(conn.data.room)) {
              c.sendJSON({
                type: 'updated',
                room: conn.data.room,
                message: messages.shapeMessage(res.message, {
                  id: c.data.user?.id || null,
                  role: c.data.role,
                  actor: c.data.actor,
                }),
              });
            }
            return;
          }

          /* 删除 */
          case 'delete': {
            const id = String(inMsg.id || '');
            const res = messages.deleteMessage(id, { userId: user?.id || null, actor: conn.data.actor, role: conn.data.role });
            if (res.error) {
              const map = { not_found: '消息不存在', forbidden: '没有权限删除', deleted: '消息已删除' };
              return reply(res.error, map[res.error] || '删除失败', { messageId: id });
            }
            for (const c of roomOccupants(conn.data.room)) {
              c.sendJSON({ type: 'deleted', room: conn.data.room, id, deletedAt: res.deletedAt });
            }
            return;
          }

          /* 表情回应 */
          case 'react': {
            const id = String(inMsg.id || '');
            const emoji = String(inMsg.emoji || '');
            const target = messages.findMessage(id, { id: user?.id || null, role: conn.data.role, actor: conn.data.actor });
            if (!target) return reply('not_found', '消息不存在', { messageId: id });
            if (!C.reactions.includes(emoji)) return reply('bad_emoji', '不支持的表情', { messageId: id });
            let added;
            try {
              added = chat.toggleReaction(id, conn.data.actor, emoji);
            } catch (err) {
              return reply('bad_emoji', err.message, { messageId: id });
            }
            const map = chat.reactionsFor([id]);
            const raw = map.get(id) || [];
            // mine 是相对接收者的，必须逐连接塑形
            for (const c of roomOccupants(conn.data.room)) {
              if (!c.writable) continue;
              c.sendJSON({
                type: 'reaction',
                room: conn.data.room,
                id,
                added,
                reactions: raw.map((r) => ({ emoji: r.emoji, count: r.count, mine: r.actors.includes(c.data.actor) })),
              });
            }
            return;
          }

          /* 客户端心跳，回复服务端时间用于测延迟 */
          case 'ping':
            send(conn, { type: 'pong', at: inMsg.at || null, serverTime: new Date().toISOString() });
            return;

          default:
            reply('unknown_type', `未知指令：${inMsg.type}`);
          }
        } catch (err) {
          log(`处理 ${inMsg.type} 失败：${err.message}`);
          reply(err.code || 'internal', err.code === 'too_long' || err.code === 'empty' ? err.message : '服务端处理失败，请稍后再试');
        }
      };
      conn.on('message', onFrame);

      conn.on('close', () => {
        const room = conn.data?.room;
        const nick = conn.data?.nickname;
        leaveRoom(conn);
        typingSentAt.delete(conn.id);
        if (room) {
          // 自身已从 presence 中移除，这里拿到的就是最新在线人数
          const n = chat.roomCounts().get(room) || 0;
          broadcast({ type: 'exited', room, nickname: nick, online: n }, room);
          broadcast({ type: 'presence', room, online: n, onlineList: onlineList(room) }, room);
        }
        broadcastRooms();
        log(`断开 ${nick}，当前连接 ${clients.size}`);
      });
    },
  });

  process.once('exit', () => {
    limiter.stop();
    clearInterval(pruneTyping);
    chat.clearPresence();
  });

  log(`聊天室已就绪：ws://<host>/ws（房间 ${chat.listRooms(new Map(), null).length} 个，限流 ${C.rateMax}/${C.rateWindowMs}ms）`);
  return clients;
}
