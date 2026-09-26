import { all, get, run } from '../db.js';
import { randomId, nowIso } from '../lib/id.js';
import { verify } from '../lib/jwt.js';
import config from '../config.js';

const MAX_MESSAGES = 300;

function shape(row) {
  return {
    id: row.id,
    room: row.room,
    kind: row.kind,
    body: row.body,
    nickname: row.nickname,
    isMe: !!row.user_id && row.user_id === row.viewer,
    createdAt: row.created_at,
  };
}

/** 供 WebSocket 广播使用：把原始行转换成与 history 一致的结构 */
export function shapeMessage(row, viewerId = null) {
  return shape({ ...row, viewer: viewerId });
}

function selectRoom(room, limit = 50) {
  return all(
    `SELECT m.*, ? AS viewer FROM messages m WHERE m.room = ? ORDER BY m.created_at DESC LIMIT ?`,
    [null, room, limit],
  ).reverse();
}

export function history(room = 'lobby', viewerId = null, limit = 50) {
  return all(
    `SELECT m.*, ? AS viewer FROM messages m WHERE m.room = ? ORDER BY m.created_at DESC LIMIT ?`,
    [viewerId, room, limit],
  )
    .reverse()
    .map((r) => shape(r));
}

export function add({ room = 'lobby', userId = null, nickname, body, kind = 'chat' }) {
  const id = randomId(10);
  run('INSERT INTO messages (id, room, user_id, nickname, kind, body, created_at) VALUES (?,?,?,?,?,?,?)', [
    id,
    room,
    userId,
    nickname,
    kind,
    String(body).slice(0, 1000),
    nowIso(),
  ]);
  // 只保留最近 MAX_MESSAGES 条
  run(
    `DELETE FROM messages WHERE room = ? AND id NOT IN
     (SELECT id FROM messages WHERE room = ? ORDER BY created_at DESC LIMIT ?)`,
    [room, room, MAX_MESSAGES],
  );
  return get('SELECT * FROM messages WHERE id = ?', [id]);
}

export function online() {
  return get('SELECT COUNT(*) AS c FROM messages WHERE created_at > ?', [new Date(Date.now() - 15 * 60000).toISOString()]).c;
}

export function clearRoom(room) {
  run('DELETE FROM messages WHERE room = ?', [room]);
  return true;
}

/** 简单的聊天指令 */
export function runCommand(command, user) {
  const [cmd, ...rest] = command.trim().split(/\s+/);
  switch (cmd) {
    case '/help':
      return '可用指令：/help 帮助 · /who 在线人数 · /time 服务器时间 · /me 动作 · /clear 需管理员清空';
    case '/who': {
      const live = Number(user?.online);
      return Number.isFinite(live) && live > 0
        ? `当前在线：${live} 人`
        : `近 15 分钟活跃：${online()} 人`;
    }
    case '/time':
      return `服务器时间：${new Date().toLocaleString('zh-CN')}`;
    case '/me':
      return `${user?.nickname || '匿名'} ${rest.join(' ')}`;
    default:
      return null;
  }
}

export { verify, config };
