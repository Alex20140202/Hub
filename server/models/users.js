import { all, get, run } from '../db.js';
import { newSessionId } from '../lib/token.js';
import { config } from '../config.js';

const PUBLIC_COLUMNS = `id, email, username, nickname, role, bio, avatar_hue AS avatarHue, theme, accent,
  skin, frame, title, storage_bonus AS storageBonus, points, created_at AS createdAt`;

export const findById = (id) => get(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, id);
export const findByEmail = (email) => get('SELECT * FROM users WHERE email = ?', String(email).toLowerCase());
export const findByUsername = (username) => get(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE username = ?`, username);
export const findProfile = (username) =>
  get(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE username = ? OR CAST(id AS TEXT) = ?`, username, String(username));

export const listUsers = (limit = 50) =>
  all(
    `SELECT ${PUBLIC_COLUMNS}, (SELECT COUNT(*) FROM notes WHERE notes.user_id = users.id) AS noteCount,
            (SELECT COUNT(*) FROM links WHERE links.user_id = users.id) AS linkCount
       FROM users ORDER BY id LIMIT ?`,
    limit,
  );

export const countUsers = () => get('SELECT COUNT(*) AS n FROM users').n;

export const findNickname = (id) => get('SELECT nickname FROM users WHERE id = ?', id)?.nickname ?? '某人';

export function createUser({ email, username, nickname, passwordHash, role = 'user' }) {
  const hue = Math.floor(Math.random() * 360);
  const { lastInsertRowid } = run(
    'INSERT INTO users (email, username, nickname, password_hash, role, avatar_hue) VALUES (?, ?, ?, ?, ?, ?)',
    email,
    username,
    nickname,
    passwordHash,
    role,
    hue,
  );
  return findById(lastInsertRowid);
}

export function updateProfile(id, { nickname, username, bio, theme, accent, avatarHue }) {
  const current = get('SELECT * FROM users WHERE id = ?', id);
  if (!current) return null;
  run(
    'UPDATE users SET nickname = ?, username = ?, bio = ?, theme = ?, accent = ?, avatar_hue = ? WHERE id = ?',
    nickname ?? current.nickname,
    username ?? current.username,
    bio ?? current.bio,
    theme ?? current.theme,
    accent ?? current.accent,
    avatarHue ?? current.avatar_hue,
    id,
  );
  return findById(id);
}

export const setPassword = (id, passwordHash) => run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, id);
export const setRole = (id, role) => run('UPDATE users SET role = ? WHERE id = ?', role, id);
export const removeUser = (id) => run('DELETE FROM users WHERE id = ?', id);

export const emailTaken = (email, exceptId = null) =>
  Boolean(
    get('SELECT id FROM users WHERE email = ? AND id IS NOT ?', String(email).toLowerCase(), exceptId),
  );

export const usernameTaken = (username, exceptId = null) =>
  Boolean(get('SELECT id FROM users WHERE username = ? AND id IS NOT ?', username, exceptId));

/* ---------------------------------- 会话 ---------------------------------- */

export function createSession(userId, { userAgent = '', ip = '' } = {}) {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + config.tokenTtlMs).toISOString();
  run(
    'INSERT INTO sessions (id, user_id, user_agent, ip, expires_at) VALUES (?, ?, ?, ?, ?)',
    id,
    userId,
    String(userAgent).slice(0, 200),
    String(ip).slice(0, 60),
    expiresAt,
  );
  purgeSessions();
  return { id, expiresAt };
}

export const findSession = (id) =>
  get('SELECT id, user_id AS userId, user_agent AS userAgent, ip, created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt FROM sessions WHERE id = ?', id);
export const touchSession = (id) => run("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?", id);
export const deleteSession = (id) => run('DELETE FROM sessions WHERE id = ?', id);
export const deleteUserSessions = (userId, exceptId = null) =>
  run('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?', userId, exceptId);

export const listSessions = (userId) =>
  all(
    'SELECT id, user_agent AS userAgent, ip, created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC',
    userId,
  );

function purgeSessions() {
  run("DELETE FROM sessions WHERE expires_at < datetime('now')");
}

/** 把整数主键转成普通数字，便于 JSON 序列化。 */
export const toPublic = (user) => (user ? { ...user, id: Number(user.id) } : null);

export { PUBLIC_COLUMNS };
