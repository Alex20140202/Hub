import { all, get, run } from '../db.js';
import { randomId, nowIso } from '../lib/id.js';
import * as chat from './chat.js';
import config from '../config.js';

const C = config.chat;
const KINDS = new Set(['chat', 'system', 'action', 'join', 'leave']);
const PRUNE_EVERY = 25;

let insertsSincePrune = 0;

function parseMeta(raw) {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * 把原始行转换成前端结构。
 * viewer = { id, role, actor }；actor 是稳定身份（u:xxx / g:xxx），
 * 游客没有 user_id，只能靠 actor 才能正确识别「这条是我发的」。
 */
function shape(row, viewer = {}) {
  const deleted = !!row.deleted_at;
  const meta = deleted ? {} : parseMeta(row.meta);
  const isAuthed = !!row.user_id && !!viewer.id;
  const mine = isAuthed ? row.user_id === viewer.id : !!meta.actor && meta.actor === viewer.actor;
  const admin = viewer.role === 'admin';
  return {
    id: row.id,
    room: row.room,
    kind: KINDS.has(row.kind) ? row.kind : 'chat',
    body: deleted ? '' : row.body,
    nickname: row.nickname,
    userId: row.user_id || null,
    isMe: mine,
    canEdit: isAuthed && mine && !deleted,
    canDelete: (isAuthed && mine) || admin,
    editedAt: row.edited_at || null,
    deleted,
    createdAt: row.created_at,
    meta,
    replyTo: row.reply_nickname
      ? {
          id: row.reply_to,
          nickname: row.reply_nickname,
          body: row.reply_deleted ? '（该消息已被删除）' : String(row.reply_body || '').slice(0, 120),
        }
      : null,
    reactions: row.reactions ? JSON.parse(row.reactions) : [],
  };
}

const SELECT = `
  SELECT m.*,
         m.rowid AS seq,
         ? AS viewer,
         (SELECT r.nickname FROM messages r WHERE r.id = m.reply_to) AS reply_nickname,
         (SELECT r.body      FROM messages r WHERE r.id = m.reply_to) AS reply_body,
         (SELECT r.deleted_at FROM messages r WHERE r.id = m.reply_to) AS reply_deleted
    FROM messages m`;

const view = (v) => (v && v.id !== undefined ? v : { id: v ?? null, role: null, actor: null });

/**
 * 取单条并带上被引用消息的摘要列。
 * add()/updateMessage() 的返回值会直接进广播，必须经这里 hydrate，
 * 否则 replyTo 分支拿不到 reply_* 字段（广播里就没有引用摘要）。
 */
function joined(id, viewerId = null) {
  return get(`${SELECT} WHERE m.id = ?`, [viewerId, id]);
}

/* ================= 分页游标 ================= */

/**
 * created_at 只有毫秒精度，批量插入时必然撞时间戳。
 * 单纯用 `created_at < cursor` 翻页会整段跳过同毫秒的消息（静默丢消息），
 * 所以排序必须是 (created_at, rowid) 的全序，rowid 由 SQLite 保证单调递增。
 */
const ORDER = 'ORDER BY m.created_at DESC, m.rowid DESC';
const encodeCursor = (row) => `${row.created_at}|${row.seq}`;
const decodeCursor = (cursor) => {
  if (!cursor) return null;
  const raw = String(cursor);
  const i = raw.lastIndexOf('|');
  if (i < 0) return null;
  const at = raw.slice(0, i);
  const seq = Number(raw.slice(i + 1));
  return Number.isFinite(seq) ? { at, seq } : null;
};

/** 广播用：与 history() 输出结构完全一致 */
export function shapeMessage(row, viewer, reactionMap) {
  if (!row) return null;
  const v = view(viewer);
  const list = reactionMap?.get(row.id) || [];
  const shaped = shape({ ...row, viewer: v.id }, v);
  shaped.reactions = list.map((r) => ({ emoji: r.emoji, count: r.count, mine: r.actors.includes(v.actor) }));
  return shaped;
}

export function findMessage(id, viewer) {
  const v = view(viewer);
  const row = get(`${SELECT} WHERE m.id = ?`, [v.id, id]);
  if (!row) return null;
  return shapeMessage(row, v, chat.reactionsFor([id]));
}

/**
 * 分页历史：返回时间升序的 messages，以及用于「加载更早」的游标。
 * before 传上一页最早一条的游标（服务端下发的不透明字符串）。
 */
export function history(room = 'lobby', viewer, { limit = C.pageSize, before = null } = {}) {
  const v = view(viewer);
  const take = Math.max(1, Math.min(C.pageMax, Number(limit) || C.pageSize));
  const params = [v.id];
  let where = 'WHERE m.room = ?';
  params.push(room);
  const cur = decodeCursor(before);
  if (before && !cur) {
    // 游标格式不认识时退化为只按时间比较，至少不会报错
    where += ' AND m.created_at < ?';
    params.push(String(before).slice(0, 40));
  } else if (cur) {
    where += ' AND (m.created_at < ? OR (m.created_at = ? AND m.rowid < ?))';
    params.push(cur.at, cur.at, cur.seq);
  }
  const rows = all(`${SELECT} ${where} ${ORDER} LIMIT ?`, [...params, take + 1]);
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  page.reverse();
  const reactionMap = chat.reactionsFor(page.map((r) => r.id));
  return {
    items: page.map((r) => shapeMessage(r, v, reactionMap)),
    hasMore,
    cursor: hasMore && page.length ? encodeCursor(page[0]) : null,
  };
}

/** 只需 id 列表的场景，避免加载 reactions */
function assertBody(body) {
  const text = String(body ?? '');
  if (!text.trim()) {
    const err = new Error('消息不能为空');
    err.code = 'empty';
    throw err;
  }
  if (text.length > C.bodyMax) {
    const err = new Error(`消息最长 ${C.bodyMax} 字，当前 ${text.length} 字`);
    err.code = 'too_long';
    throw err;
  }
  return text;
}

export function add({
  room = 'lobby',
  userId = null,
  nickname,
  body,
  kind = 'chat',
  replyTo = null,
  meta = null,
  actor = null,
}) {
  const text = kind === 'chat' || kind === 'action' ? assertBody(body) : String(body ?? '').slice(0, C.bodyMax);
  if (replyTo) {
    const parent = get('SELECT id FROM messages WHERE id = ? AND room = ?', [String(replyTo), room]);
    replyTo = parent ? parent.id : null;
  }
  const id = randomId(12);
  // actor 落库：游客没有 user_id，靠它才能稳定判断消息归属
  const payload = { ...(meta && typeof meta === 'object' ? meta : {}) };
  if (actor && !payload.actor) payload.actor = actor;
  run(
    'INSERT INTO messages (id, room, user_id, nickname, kind, body, reply_to, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [
      id,
      room,
      userId,
      chat.sanitizeNickname(nickname, '游客'),
      KINDS.has(kind) ? kind : 'chat',
      text,
      replyTo,
      JSON.stringify(payload),
      nowIso(),
    ],
  );
  // 批量清理：每 N 条才裁剪一次，避免每条消息都跑一次全表子查询
  if (++insertsSincePrune >= PRUNE_EVERY) {
    insertsSincePrune = 0;
    prune(room);
  }
  // 返回带引用摘要的行，广播才能渲染引用块
  return joined(id);
}

/**
 * 裁剪单个房间，只保留最近 keep 条。
 * 必须按 rowid（写入顺序）而不是 id —— id 是随机串，按 id 排序会留下任意子集，
 * 结果是「刚发的消息被裁掉、很久以前的反而留着」。
 */
export function prune(room = 'lobby', keep = C.keepPerRoom) {
  run(
    `DELETE FROM messages
      WHERE room = ? AND rowid NOT IN (SELECT rowid FROM messages WHERE room = ? ORDER BY rowid DESC LIMIT ?)`,
    [room, room, keep],
  );
  run(
    `DELETE FROM chat_reactions
      WHERE message_id NOT IN (SELECT id FROM messages)`,
  );
  return true;
}

const EDIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * 归属判定：
 *  - 登录用户按 user_id
 *  - 游客按 meta.actor（改名时会迁移，见 chat.renameActor）
 * 绝不能用 null === null 判断，否则任意游客可改任意游客消息。
 */
function owns(row, { userId = null, actor = null }) {
  if (row.user_id) return !!userId && row.user_id === userId;
  const owner = parseMeta(row.meta).actor;
  return !!owner && !!actor && owner === actor;
}

export function updateMessage(id, body, { userId = null, actor = null, role = null }) {
  const row = get('SELECT * FROM messages WHERE id = ?', [id]);
  if (!row) return { error: 'not_found' };
  if (!owns(row, { userId, actor })) return { error: 'forbidden' };
  if (row.deleted_at) return { error: 'deleted' };
  if (Date.now() - new Date(row.created_at).getTime() > EDIT_WINDOW_MS) return { error: 'expired' };
  let text;
  try {
    text = assertBody(body);
  } catch (err) {
    return { error: err.code || 'invalid' };
  }
  const at = nowIso();
  run('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', [text, at, id]);
  return { message: joined(id), editedAt: at, role };
}

export function deleteMessage(id, { userId = null, actor = null, role = null }) {
  const row = get('SELECT * FROM messages WHERE id = ?', [id]);
  if (!row) return { error: 'not_found' };
  if (!owns(row, { userId, actor }) && role !== 'admin') return { error: 'forbidden' };
  if (row.deleted_at) return { error: 'deleted' };
  const at = nowIso();
  // 软删除：保留行以便引用它的回复显示占位
  run("UPDATE messages SET deleted_at = ?, body = '' WHERE id = ?", [at, id]);
  run('DELETE FROM chat_reactions WHERE message_id = ?', [id]);
  return { deletedAt: at, role };
}

export function addSystem(room, text, meta = null) {
  return add({ room, nickname: '系统', body: text, kind: 'system', meta });
}

export function clearRoom(room) {
  run('DELETE FROM messages WHERE room = ?', [room]);
  run('DELETE FROM chat_reactions WHERE message_id NOT IN (SELECT id FROM messages)');
  run('DELETE FROM chat_reads WHERE room = ?', [room]);
  insertsSincePrune = 0;
  return true;
}

/** 供管理后台：按昵称/用户检索消息 */
export function search({ room = null, q = '', kind = null, limit = 50, before = null } = {}) {
  const params = [null];
  let where = 'WHERE 1 = 1';
  if (room) {
    where += ' AND m.room = ?';
    params.push(room);
  }
  if (kind) {
    where += ' AND m.kind = ?';
    params.push(kind);
  }
  if (q) {
    where += ' AND (m.body LIKE ? OR m.nickname LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (before) {
    where += ' AND m.created_at < ?';
    params.push(before);
  }
  const take = Math.max(1, Math.min(C.pageMax, Number(limit) || 50));
  const rows = all(`${SELECT} ${where} ${ORDER} LIMIT ?`, [...params, take]);
  return rows.map((r) => shapeMessage(r, { id: null, role: null, actor: null }, chat.reactionsFor(rows.map((x) => x.id))));
}

/* ================= 指令 ================= */

export const COMMANDS = [
  { cmd: '/help', usage: '/help', desc: '查看指令列表' },
  { cmd: '/who', usage: '/who', desc: '在线人数' },
  { cmd: '/online', usage: '/online', desc: '列出在线的人' },
  { cmd: '/time', usage: '/time', desc: '服务器时间' },
  { cmd: '/me', usage: '/me 挥手', desc: '以动作形式发言' },
  { cmd: '/nick', usage: '/nick 新名字', desc: '修改自己的昵称' },
  { cmd: '/topic', usage: '/topic 新主题', desc: '管理员设置房间主题' },
  { cmd: '/rooms', usage: '/rooms', desc: '列出所有房间' },
  { cmd: '/clear', usage: '/clear', desc: '管理员清空当前房间' },
  { cmd: '/mute', usage: '/mute 名字 10', desc: '管理员禁言（分钟，0 为永久）' },
  { cmd: '/unmute', usage: '/unmute 名字', desc: '管理员解除禁言' },
  { cmd: '/roll', usage: '/roll', desc: '掷骰子' },
  { cmd: '/shrug', usage: '/shrug', desc: ' shrug ヽ( ゜-゜)ノ' },
];

/**
 * 聊天指令。返回 string 表示要广播的系统消息，null 表示不是指令。
 * ctx 由 WebSocket 层提供：{ user, nickname, actor, role, room, online, onlineList, rooms }
 */
export function runCommand(command, ctx) {
  const [cmd, ...rest] = command.trim().split(/\s+/);
  const arg = rest.join(' ');
  const nick = ctx?.nickname || '匿名';
  switch (cmd) {
    case '/help':
      return `可用指令：${COMMANDS.map((c) => c.usage).join(' · ')}`;
    case '/who': {
      const live = Number(ctx?.online);
      return Number.isFinite(live) ? `当前在线：${live} 人` : '当前在线：统计不可用';
    }
    case '/online': {
      const list = (ctx?.onlineList || []).slice(0, 20);
      if (!list.length) return '当前房间里只有你一个人';
      return `在线（${list.length}）：${list.join('、')}`;
    }
    case '/time':
      return `服务器时间：${new Date().toLocaleString('zh-CN')}`;
    case '/rooms': {
      const rooms = (ctx?.rooms || []).map((r) => r.name).join('、');
      return rooms ? `房间：${rooms}` : '暂无房间';
    }
    case '/me':
      return arg ? `${nick} ${arg}` : null;
    case '/nick': {
      const next = chat.sanitizeNickname(arg, '');
      if (!next) return '用法：/nick 你的新昵称';
      if (ctx.setNickname) ctx.setNickname(next);
      return next ? `昵称已改为 ${next}` : null;
    }
    case '/topic': {
      if (ctx?.role !== 'admin') return '仅管理员可以设置房间主题';
      if (!arg) return '用法：/topic 新的房间主题';
      if (ctx.setTopic) ctx.setTopic(arg.slice(0, 80));
      return `房间主题已更新：${arg.slice(0, 80)}`;
    }
    case '/clear': {
      if (ctx?.role !== 'admin') return '仅管理员可以清空房间';
      if (ctx.clearRoom) ctx.clearRoom();
      return '本房间消息已清空（历史不可恢复）';
    }
    case '/mute': {
      if (ctx?.role !== 'admin') return '仅管理员可以禁言';
      const minutes = Math.max(0, Math.min(60 * 24 * 7, Number(rest[1]) || 0));
      const targetName = rest[0] ? chat.sanitizeNickname(rest[0], '') : '';
      if (!targetName) return '用法：/mute 昵称 分钟';
      if (ctx.mute) ctx.mute(targetName, minutes, arg.replace(rest[0] || '').replace(rest[1] || '').trim() || '管理员禁言');
      return minutes ? `已禁言 ${targetName} ${minutes} 分钟` : `已永久禁言 ${targetName}`;
    }
    case '/unmute': {
      if (ctx?.role !== 'admin') return '仅管理员可以解除禁言';
      const targetName = rest[0] ? chat.sanitizeNickname(rest[0], '') : '';
      if (!targetName) return '用法：/unmute 昵称';
      if (ctx.unmute) ctx.unmute(targetName);
      return `已解除 ${targetName} 的禁言`;
    }
    case '/roll': {
      const n = Math.floor(Math.random() * 100) + 1;
      return `${nick} 掷出了 ${n}`;
    }
    case '/shrug':
      return `${nick} ¯\\_(ツ)_/¯`;
    default:
      return null;
  }
}

export { chat };
