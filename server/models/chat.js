import { all, get, run, tx } from '../db.js';
import { randomId, nowIso } from '../lib/id.js';
import HttpError from '../lib/http-error.js';
import config from '../config.js';

const C = config.chat;

/* ================= 在线状态（进程内） ================= */

/**
 * 在线状态放模型层而不是 WS 层：
 * WS 负责维护，REST 的房间列表/未读接口也要读，两边共用同一份才不会各说各话。
 * 单进程部署下内存即真相。
 */
const presence = new Map(); // room -> Map<connId, { nick, userId }>
const connRoom = new Map(); // connId -> room

export function enterPresence(connId, room, nick, userId = null) {
  connRoom.set(connId, room);
  if (!presence.has(room)) presence.set(room, new Map());
  presence.get(room).set(connId, { nick, userId });
  return room;
}

export function movePresence(connId, room, nick, userId = null) {
  const from = connRoom.get(connId);
  if (from) {
    const set = presence.get(from);
    if (set) {
      set.delete(connId);
      if (!set.size) presence.delete(from);
    }
  }
  return enterPresence(connId, room, nick, userId);
}

export function leavePresence(connId) {
  const room = connRoom.get(connId);
  if (!room) return null;
  connRoom.delete(connId);
  const set = presence.get(room);
  if (set) {
    set.delete(connId);
    if (!set.size) presence.delete(room);
  }
  return room;
}

export function roomOf(connId) {
  return connRoom.get(connId) || null;
}

/** room -> 在线人数 */
export function roomCounts() {
  const map = new Map();
  for (const [room, set] of presence) map.set(room, set.size);
  return map;
}

/** 房间内去重后的在线昵称 */
export function onlineList(room) {
  const out = [];
  for (const p of presence.get(room)?.values() || []) {
    if (p.nick && !out.includes(p.nick)) out.push(p.nick);
  }
  return out;
}

export function clearPresence() {
  presence.clear();
  connRoom.clear();
}

/* ================= 昵称净化 ================= */

/** 昵称里的换行、控制字符会破坏气泡排版，也会让伪造昵称冒充他人，统一清洗 */
export function sanitizeNickname(input, fallback = '游客') {
  const raw = String(input ?? '')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
  // 保留文字、数字与常见标点；剔除 < > & " ' ` （可伪造 HTML/属性）与 | （被用作 reactions 的分组分隔符）
  const cleaned = raw.replace(
    /[^\p{L}\p{N}\p{Extended_Pictographic} _.,!?()[\]{}#*+=~$^/\\:;《》「」、。，！？；（）【】…—·]/gu,
    '',
  );
  const cut = cleaned.slice(0, 20).trim();
  return cut || fallback;
}

/** 访客标识：浏览器本地生成的随机串，服务端只做字符集收敛 */
const GUEST_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

export function normalizeGuestId(input) {
  const raw = String(input ?? '').trim();
  return GUEST_ID_RE.test(raw) ? raw : '';
}

/**
 * 连接身份。
 * 登录用户用 user id；游客必须用 guestId，
 * 只用昵称会让两个同名游客共享 actor，从而互相「编辑/删除」对方消息。
 * 没有 guestId 的老客户端/脚本降级到昵称（功能受限但不报错）。
 */
export function actorKey({ userId = null, nickname, guestId = '' }) {
  if (userId) return `u:${userId}`;
  const gid = normalizeGuestId(guestId);
  return gid ? `g:${gid}` : `n:${nickname}`;
}

/* ================= 房间 ================= */

function shapeRoom(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    topic: row.topic,
    kind: row.kind,
    sort: row.sort,
    online: Number(row.online || 0),
    unread: Number(row.unread || 0),
    lastRead: row.last_read || null,
    createdAt: row.created_at,
  };
}

export const SYSTEM_ROOM = 'lobby';

/**
 * 列出房间并附带在线人数与当前用户的未读数。
 * live 为 Map<slug, count>，来自 WebSocket 连接的实时统计。
 */
export function listRooms(liveCounts, viewerId = null) {
  const counts = liveCounts instanceof Map ? liveCounts : new Map();
  const rooms = all('SELECT * FROM chat_rooms ORDER BY sort, name');
  return rooms.map((row) => {
    const lastRead = viewerId
      ? (get('SELECT last_read FROM chat_reads WHERE user_id = ? AND room = ?', [viewerId, row.slug])?.last_read ||
        '1970-01-01T00:00:00.000Z')
      : '1970-01-01T00:00:00.000Z';
    return shapeRoom({
      ...row,
      online: counts.get(row.slug) || 0,
      last_read: viewerId ? lastRead : null,
    });
  });
}

/** 带未读数的房间列表（登录用户才有意义） */
export function listRoomsWithUnread(liveCounts, viewerId) {
  return listRooms(liveCounts, viewerId).map((room) => {
    if (!viewerId) return { ...room, unread: 0 };
    const row = get(
      `SELECT COUNT(*) AS c FROM messages
        WHERE room = ? AND created_at > ? AND (user_id IS NULL OR user_id != ?)`,
      [room.slug, room.lastRead, viewerId],
    );
    return { ...room, unread: row?.c || 0 };
  });
}

export function findRoom(slug) {
  const row = get('SELECT * FROM chat_rooms WHERE slug = ? OR id = ?', [String(slug || ''), String(slug || '')]);
  return shapeRoom(row);
}

export function roomExists(slug) {
  return !!get('SELECT id FROM chat_rooms WHERE slug = ?', [String(slug || '')]);
}

function slugify(input) {
  const base = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .slice(0, 20)
    .replace(/^-|-$/g, '');
  return base || `room-${randomId(6).toLowerCase()}`;
}

function uniqueSlug(base) {
  let slug = base;
  let n = 2;
  while (get('SELECT id FROM chat_rooms WHERE slug = ?', [slug])) slug = `${base}-${n++}`;
  return slug;
}

export function createRoom({ name, topic = '', createdBy = null, kind = 'public' }) {
  const slug = uniqueSlug(slugify(name));
  const id = randomId(12);
  const row = { slug, name: String(name).slice(0, 24), topic: String(topic).slice(0, 80) };
  run(
    'INSERT INTO chat_rooms (id, slug, name, topic, kind, sort, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [id, row.slug, row.name, row.topic, kind, 900, createdBy, nowIso()],
  );
  return findRoom(slug);
}

const EDITABLE = new Set(['name', 'topic', 'sort', 'kind']);

export function updateRoom(slug, patch = {}) {
  const room = get('SELECT * FROM chat_rooms WHERE slug = ?', [String(slug)]);
  if (!room) return null;
  if (room.kind === 'system') throw new Error('系统房间不可编辑');
  const next = {};
  for (const key of Object.keys(patch)) {
    if (!EDITABLE.has(key)) continue;
    if (key === 'sort') next.sort = Math.max(0, Math.min(9999, Number(patch.sort) || 0));
    else if (key === 'name') next.name = String(patch.name || '').trim().slice(0, 24) || room.name;
    else if (key === 'topic') next.topic = String(patch.topic || '').slice(0, 80);
    else if (key === 'kind') next.kind = patch.kind === 'private' ? 'private' : 'public';
  }
  if (!Object.keys(next).length) return shapeRoom(room);
  const setSql = Object.keys(next).map((k) => `${k} = ?`).join(', ');
  run(`UPDATE chat_rooms SET ${setSql} WHERE id = ?`, [...Object.values(next), room.id]);
  return findRoom(room.slug);
}

export function deleteRoom(slug) {
  const room = get('SELECT * FROM chat_rooms WHERE slug = ?', [String(slug)]);
  if (!room) return false;
  if (room.kind === 'system') return false;
  return tx(() => {
    run('DELETE FROM messages WHERE room = ?', [room.slug]);
    run('DELETE FROM chat_reactions WHERE message_id NOT IN (SELECT id FROM messages)');
    run('DELETE FROM chat_reads WHERE room = ?', [room.slug]);
    run('DELETE FROM chat_rooms WHERE id = ?', [room.id]);
    return true;
  });
}

/**
 * 游客改名后迁移其历史消息的归属，否则改名就等于放弃旧消息的编辑/删除权。
 * 顺带证明 meta 里的其他字段（如 /me 的 command）不会被 json_set 破坏。
 */
export function renameActor(oldActor, newActor) {
  if (!oldActor || !newActor || oldActor === newActor) return 0;
  const r = run(
    `UPDATE messages SET meta = json_set(meta, '$.actor', ?)
      WHERE json_extract(meta, '$.actor') IS NOT NULL AND json_extract(meta, '$.actor') = ?`,
    [newActor, oldActor],
  );
  return r.changes || 0;
}

/* ================= 已读位点 ================= */

export function lastRead(userId, room) {
  if (!userId) return null;
  return get('SELECT last_read FROM chat_reads WHERE user_id = ? AND room = ?', [userId, room])?.last_read || null;
}

export function markRead(userId, room, at = nowIso()) {
  if (!userId) return null;
  run(
    `INSERT INTO chat_reads (user_id, room, last_read) VALUES (?,?,?)
     ON CONFLICT(user_id, room) DO UPDATE SET last_read = MAX(last_read, excluded.last_read)`,
    [userId, room, at],
  );
  return at;
}

/** 房间内比某时间更新的消息数（不含自己发的） */
export function unreadCount(userId, room) {
  if (!userId) return 0;
  const at = lastRead(userId, room) || '1970-01-01T00:00:00.000Z';
  const row = get(
    `SELECT COUNT(*) AS c FROM messages
      WHERE room = ? AND created_at > ? AND (user_id IS NULL OR user_id != ?)`,
    [room, at, userId],
  );
  return row?.c || 0;
}

/* ================= 表情回应 ================= */

export function reactionsFor(messageIds) {
  const map = new Map();
  const ids = [...messageIds].filter(Boolean);
  if (!ids.length) return map;
  const placeholders = ids.map(() => '?').join(',');
  // 分隔符必须显式指定：GROUP_CONCAT 默认是 ','，而昵称里可能含逗号，会把 actors 切错
  const rows = all(
    `SELECT message_id, emoji, COUNT(*) AS c, GROUP_CONCAT(actor, '|') AS actors
       FROM chat_reactions WHERE message_id IN (${placeholders}) GROUP BY message_id, emoji`,
    ids,
  );
  for (const r of rows) {
    if (!map.has(r.message_id)) map.set(r.message_id, []);
    map.get(r.message_id).push({ emoji: r.emoji, count: r.c, actors: String(r.actors || '').split('|') });
  }
  // 按表情码点排序，保证所有端渲染顺序一致
  for (const list of map.values()) list.sort((a, b) => (a.emoji < b.emoji ? -1 : 1));
  return map;
}

export function toggleReaction(messageId, actor, emoji) {
  if (!C.reactions.includes(emoji)) throw new Error('不支持的表情');
  const existing = get('SELECT 1 AS x FROM chat_reactions WHERE message_id = ? AND actor = ? AND emoji = ?', [
    messageId,
    actor,
    emoji,
  ]);
  if (existing) {
    run('DELETE FROM chat_reactions WHERE message_id = ? AND actor = ? AND emoji = ?', [messageId, actor, emoji]);
    return false;
  }
  run('INSERT INTO chat_reactions (message_id, actor, emoji, created_at) VALUES (?,?,?,?)', [
    messageId,
    actor,
    emoji,
    nowIso(),
  ]);
  return true;
}

/* ================= 禁言 / 踢出 ================= */

function activeMuteRow(target) {
  return get(
    `SELECT * FROM chat_mutes
      WHERE target = ? AND (until IS NULL OR until > ?)
      ORDER BY created_at DESC LIMIT 1`,
    [target, nowIso()],
  );
}

export function muteStatus(actor) {
  if (!actor) return null;
  const row = activeMuteRow(actor);
  if (!row) return null;
  return {
    id: row.id,
    reason: row.reason,
    until: row.until,
    permanent: !row.until,
    remainingMs: row.until ? new Date(row.until).getTime() - Date.now() : null,
  };
}

/**
 * 禁言断言。
 * 必须抛 HttpError：顶层错误处理器读的是 `err.status`（HTTP 状态码），
 * 把 mute 状态对象塞进 `status` 会让 writeHead 收到非法值，
 * catch 里再抛一次异常，响应永远发不出去，客户端表现为一直挂住。
 */
export function assertNotMuted(actor) {
  const status = muteStatus(actor);
  if (!status) return;
  throw HttpError.forbidden(
    status.permanent ? '你已被禁言' : `你已被禁言，剩余 ${Math.ceil((status.remainingMs || 0) / 60000)} 分钟`,
    { code: 'muted', mute: status },
  );
}

export function mute({ target, reason = '', minutes = 0, createdBy = null }) {
  const until = minutes > 0 ? new Date(Date.now() + minutes * 60000).toISOString() : null;
  const id = randomId(12);
  run(
    'INSERT INTO chat_mutes (id, scope, target, reason, until, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
    [id, 'user', target, String(reason || '').slice(0, 80), until, createdBy, nowIso()],
  );
  return { id, target, reason, until, createdAt: nowIso() };
}

export function unmute(target) {
  const r = run('DELETE FROM chat_mutes WHERE target = ?', [target]);
  return r.changes > 0;
}

export function listMutes() {
  return all(
    `SELECT m.*, u.username, u.nickname
       FROM chat_mutes m LEFT JOIN users u ON u.id = m.created_by
      ORDER BY m.created_at DESC LIMIT 100`,
  ).map((r) => ({
    id: r.id,
    target: r.target,
    reason: r.reason,
    until: r.until,
    active: !r.until || r.until > nowIso(),
    createdBy: r.nickname || r.username || '系统',
    createdAt: r.created_at,
  }));
}

/* ================= 统计 ================= */

export function stats() {
  const total = get('SELECT COUNT(*) AS c FROM messages')?.c || 0;
  const active = get('SELECT COUNT(*) AS c FROM chat_mutes WHERE until IS NULL OR until > ?', [nowIso()])?.c || 0;
  const rooms = get('SELECT COUNT(*) AS c FROM chat_rooms')?.c || 0;
  const reactions = get('SELECT COUNT(*) AS c FROM chat_reactions')?.c || 0;
  const today = get('SELECT COUNT(*) AS c FROM messages WHERE created_at >= ?', [
    new Date(new Date().toDateString()).toISOString(),
  ])?.c || 0;
  // 键名统一带计数字后缀：避免与 /admin/chat 的 mutes 列表撞名互相覆盖
  return {
    messages: total,
    messagesToday: today,
    roomCount: rooms,
    activeMutes: active,
    reactions,
  };
}
