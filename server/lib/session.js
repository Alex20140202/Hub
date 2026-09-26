/** 会话管理：JWT 中携带 sid，登出 / 删会话即刻失效 */
import config from '../config.js';
import { get, run } from '../db.js';
import { randomId, nowIso } from './id.js';

/** 新建会话，返回 sid（写入 JWT） */
export function createSession(userId, { userAgent = '', ip = '' } = {}) {
  const id = randomId(16);
  run(
    'INSERT INTO sessions (id, user_id, user_agent, ip, created_at, expires_at) VALUES (?,?,?,?,?,?)',
    [
      id,
      userId,
      String(userAgent || '').slice(0, 200),
      String(ip || '').slice(0, 60),
      nowIso(),
      new Date(Date.now() + config.auth.tokenTtlSec * 1000).toISOString(),
    ],
  );
  return id;
}

/** 会话是否仍然有效（存在且未过期） */
export function sessionActive(sid) {
  if (!sid) return false;
  return !!get('SELECT id FROM sessions WHERE id = ? AND expires_at > ?', [sid, nowIso()]);
}

export function revokeSession(sid) {
  if (sid) run('DELETE FROM sessions WHERE id = ?', [sid]);
}

export function revokeUserSessions(userId) {
  run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

/** 清理过期会话 */
export function pruneSessions() {
  run('DELETE FROM sessions WHERE expires_at <= ?', [nowIso()]);
}
