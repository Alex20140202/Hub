import { all, get, run } from '../db.js';

const COLUMNS = `id, room, user_id AS userId, nickname, kind, body, created_at AS createdAt`;

const shape = (row) => (row ? { ...row } : row);

export function listMessages(room = 'lobby', { limit = 60, beforeId = null } = {}) {
  if (beforeId) {
    return all(
      `SELECT ${COLUMNS} FROM messages WHERE room = ? AND id < ? ORDER BY id DESC LIMIT ?`,
      room,
      beforeId,
      limit,
    )
      .reverse()
      .map(shape);
  }
  return all(`SELECT ${COLUMNS} FROM messages WHERE room = ? ORDER BY id DESC LIMIT ?`, room, limit).reverse().map(shape);
}

export function addMessage({ room = 'lobby', userId = null, nickname, kind = 'chat', body }) {
  const { lastInsertRowid } = run(
    'INSERT INTO messages (room, user_id, nickname, kind, body) VALUES (?, ?, ?, ?, ?)',
    room,
    userId,
    String(nickname).slice(0, 40),
    kind,
    String(body).slice(0, 2000),
  );
  return shape(get(`SELECT ${COLUMNS} FROM messages WHERE id = ?`, lastInsertRowid));
}

export const messageCount = (room = 'lobby') => get('SELECT COUNT(*) AS n FROM messages WHERE room = ?', room).n;
export const clearMessages = (room = 'lobby') => run('DELETE FROM messages WHERE room = ?', room).changes;

export const addSystemMessage = (body) => addMessage({ nickname: '系统', kind: 'system', body });

/* --------------------------------- 订阅者 --------------------------------- */

export const subscribe = (email) => {
  const existing = get('SELECT * FROM subscribers WHERE email = ?', email);
  if (existing) {
    if (!existing.active) run('UPDATE subscribers SET active = 1 WHERE id = ?', existing.id);
    return { ...existing, active: 1, existed: true };
  }
  const { lastInsertRowid } = run('INSERT INTO subscribers (email) VALUES (?)', email);
  return shape(get('SELECT * FROM subscribers WHERE id = ?', lastInsertRowid));
};

export const unsubscribe = (email) => run('UPDATE subscribers SET active = 0 WHERE email = ?', email).changes > 0;
export const listSubscribers = (limit = 200) => all('SELECT * FROM subscribers ORDER BY id DESC LIMIT ?', limit);
export const subscriberCount = () => get('SELECT COUNT(*) AS n FROM subscribers WHERE active = 1').n;
