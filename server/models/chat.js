import { all, get, run } from '../db.js';
import { notFound, badRequest } from '../lib/http-error.js';

const COLUMNS = `m.id, m.room, m.user_id AS userId, m.nickname, m.kind, m.body, m.pinned,
  m.created_at AS createdAt, m.attachment_id AS attachmentId, m.reply_to AS replyTo`;

const shape = (row, { reply = true, reads = false } = {}) => {
  if (!row) return null;
  const message = { ...row, pinned: Boolean(row.pinned) };

  if (reply && row.replyTo) {
    const quoted = get(
      `SELECT id, nickname, kind, body, attachment_id AS attachmentId FROM messages WHERE id = ?`,
      row.replyTo,
    );
    if (quoted) {
      message.quote = {
        id: quoted.id,
        nickname: quoted.nickname,
        // 被回复的消息若含附件，只展示文件名，不重复嵌套卡片
        body: quoted.attachmentId ? '[文件]' : String(quoted.body ?? '').slice(0, 160),
        kind: quoted.kind,
      };
    }
  }
  if (row.attachmentId) {
    const file = get('SELECT id, name, mime, size, downloads FROM files WHERE id = ?', row.attachmentId);
    if (file) message.attachment = { ...file, url: `/api/attachments/${file.id}` };
  }
  if (reads) {
    message.reads = all('SELECT user_id AS userId FROM message_reads WHERE message_id = ?', row.id).map((r) => r.userId);
  }
  return message;
};

/**
 * 房间历史。beforeId 不为空时向前翻页（用于上拉加载更早的消息）。
 * afterId 用于「跳到最新」之后补齐新消息。
 */
export function listMessages(room = 'lobby', { limit = 60, beforeId = null, afterId = null } = {}) {
  if (afterId) {
    return all(`SELECT ${COLUMNS} FROM messages m WHERE m.room = ? AND m.id > ? ORDER BY id ASC LIMIT ?`, room, afterId, limit)
      .map((row) => shape(row));
  }
  if (beforeId) {
    return all(`SELECT ${COLUMNS} FROM messages m WHERE m.room = ? AND m.id < ? ORDER BY id DESC LIMIT ?`, room, beforeId, limit)
      .reverse()
      .map((row) => shape(row));
  }
  return all(`SELECT ${COLUMNS} FROM messages m WHERE m.room = ? ORDER BY id DESC LIMIT ?`, room, limit)
    .reverse()
    .map((row) => shape(row));
}

/** 最早一条消息的 id：用于判断「没有更多了」。 */
export const oldestIdIn = (room) => get('SELECT MIN(id) AS id FROM messages WHERE room = ?', room)?.id ?? null;

export function addMessage({ room = 'lobby', userId = null, nickname, kind = 'chat', body = '', attachmentId = null, replyTo = null }) {
  const cleanReply = replyTo && /^\d+$/.test(String(replyTo)) ? Number(replyTo) : null;

  // 引用不能跨房间，也不能引用不存在/已删除的消息
  let replyId = null;
  if (cleanReply) {
    const target = get('SELECT id, room FROM messages WHERE id = ?', cleanReply);
    if (target && target.room === room) replyId = target.id;
  }

  const { lastInsertRowid } = run(
    'INSERT INTO messages (room, user_id, nickname, kind, body, attachment_id, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?)',
    room,
    userId,
    String(nickname).slice(0, 40),
    kind,
    String(body).slice(0, 2000),
    attachmentId,
    replyId,
  );
  // 自己发的消息默认对自己已读，省掉一个「1」的噪音
  if (userId) markRead(lastInsertRowid, userId);
  return shape(get(`SELECT ${COLUMNS} FROM messages m WHERE id = ?`, lastInsertRowid));
}

export const messageCount = (room = 'lobby') => get('SELECT COUNT(*) AS n FROM messages WHERE room = ?', room).n;
export const clearMessages = (room = 'lobby') => run('DELETE FROM messages WHERE room = ?', room).changes;
export const deleteMessage = (id) => run('DELETE FROM messages WHERE id = ?', id).changes > 0;
export const messageAuthor = (id) =>
  get('SELECT id, room, user_id AS userId, attachment_id AS attachmentId, pinned FROM messages WHERE id = ?', id);
export const findMessageByAttachment = (fileId) =>
  get('SELECT id, room, user_id AS userId, attachment_id AS attachmentId FROM messages WHERE attachment_id = ? ORDER BY id DESC LIMIT 1', fileId);

/* -------------------------------- 置顶 / 公告 -------------------------------- */

/** 房间公告：同一房间只保留一条置顶，新置顶会替换旧的。 */
export function pinMessage(id) {
  const message = get('SELECT id, room FROM messages WHERE id = ?', id);
  if (!message) throw notFound('消息不存在');
  run('UPDATE messages SET pinned = 0 WHERE room = ?', message.room);
  run('UPDATE messages SET pinned = 1 WHERE id = ?', id);
  return shape(get(`SELECT ${COLUMNS} FROM messages m WHERE id = ?`, id));
}

export const unpinMessage = (id) => {
  const message = get('SELECT id, room FROM messages WHERE id = ?', id);
  if (!message) throw notFound('消息不存在');
  run('UPDATE messages SET pinned = 0 WHERE room = ?', message.room);
  return shape(get(`SELECT ${COLUMNS} FROM messages m WHERE id = ?`, id));
};

export const pinnedMessage = (room) =>
  shape(get(`SELECT ${COLUMNS} FROM messages m WHERE m.room = ? AND m.pinned = 1 ORDER BY id DESC LIMIT 1`, room));

/* --------------------------------- 已读回执 --------------------------------- */

export function markRead(messageId, userId) {
  if (!messageId || !userId) return false;
  run('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)', messageId, userId);
  return true;
}

/** 某条消息被哪些人看过。 */
export const readersOf = (messageId) =>
  all('SELECT user_id AS userId FROM message_reads WHERE message_id = ?', messageId).map((row) => row.userId);

/* --------------------------------- 消息搜索 --------------------------------- */

/** 房间内搜索：只搜当前房间，避免跨房间泄露私聊内容。 */
export function searchMessages(room, term, { limit = 30 } = {}) {
  const keyword = String(term || '').trim();
  if (!keyword) return { term: keyword, items: [] };
  const like = `%${keyword.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const items = all(
    `SELECT ${COLUMNS} FROM messages m
      WHERE m.room = ? AND (m.body LIKE ? OR m.nickname LIKE ?)
      ORDER BY m.id DESC LIMIT ?`,
    room,
    like,
    like,
    limit,
  ).map((row) => shape(row));
  return { term: keyword, items };
}

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