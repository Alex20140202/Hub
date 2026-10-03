import { all, get, run, tx } from '../db.js';
import { randomId } from '../lib/slug.js';
import { notFound, forbidden, badRequest } from '../lib/http-error.js';
import { addMessage } from './chat.js';

/* --------------------------------- 房间基础 --------------------------------- */

const LOBBY = 'lobby';

const ROOM_COLUMNS = `r.id, r.code, r.name, r.type, r.topic, r.owner_id AS ownerId, r.avatar_hue AS avatarHue,
  r.is_public, r.max_members AS maxMembers, r.created_at AS createdAt,
  (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id) AS memberCount,
  (SELECT COUNT(*) FROM messages m WHERE m.room = r.code) AS messageCount`;

const shape = (row) => (row ? { ...row, isPublic: Boolean(row.is_public) } : row);

/** 大厅是内置房间，代码固定为 lobby，无需 room_members 记录。 */
export const lobbyCode = () => LOBBY;

export const getRoomByCode = (code) => shape(get(`SELECT ${ROOM_COLUMNS} FROM rooms r WHERE r.code = ?`, code));
export const getRoomById = (id) => shape(get(`SELECT ${ROOM_COLUMNS} FROM rooms r WHERE r.id = ?`, id));
export const roomExists = (code) => Boolean(get('SELECT 1 AS x FROM rooms WHERE code = ?', code));

/** 成员角色：owner > admin > member；null 表示不在房间里。 */
export const roleOf = (code, userId) => {
  if (code === LOBBY) return 'visitor';
  const row = get('SELECT role FROM room_members WHERE room_id = (SELECT id FROM rooms WHERE code = ?) AND user_id = ?', code, userId);
  return row?.role ?? null;
};

const requireRole = (code, userId, allowed) => {
  if (code === LOBBY) return 'visitor';
  const role = roleOf(code, userId);
  if (!role) throw notFound('房间不存在或你不是成员');
  if (allowed && !allowed.includes(role)) throw forbidden('需要房间管理员权限');
  return role;
};

export const isMember = (code, userId) => {
  if (code === LOBBY) return true;
  const room = getRoomByCode(code);
  if (!room) return false;
  // 私聊的成员关系记在 dm_threads，不在 room_members
  if (room.type === 'dm') return Boolean(peerInRoom(code, userId));
  return Boolean(roleOf(code, userId));
};

export const requireMembership = (code, userId) => {
  if (!isMember(code, userId)) throw notFound('房间不存在或你不是成员');
  return true;
};

/** 房间对某用户的可见性：true 可读，否则返回原因文案。 */
export const accessOf = (code, userId) => {
  if (code === LOBBY) return true;
  const room = getRoomByCode(code);
  if (!room) return '房间不存在';
  if (room.isPublic) return true;
  if (!userId) return '需要登录后查看';
  return isMember(code, userId) ? true : '你不是该房间成员';
};

/* --------------------------------- 群组管理 --------------------------------- */

export function createGroup(ownerId, { name, topic = '', isPublic = true, maxMembers = 50, memberIds = [] }) {
  return tx(() => {
    const code = `g-${randomId(8)}`;
    const { lastInsertRowid } = run(
      'INSERT INTO rooms (code, name, type, topic, owner_id, avatar_hue, is_public, max_members) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      code,
      name,
      'group',
      topic,
      ownerId,
      Math.floor(Math.random() * 360),
      isPublic ? 1 : 0,
      Math.min(200, Math.max(2, maxMembers)),
    );
    addMember(code, ownerId, 'owner');
    for (const id of memberIds) {
      if (Number(id) === Number(ownerId)) continue;
      if (get('SELECT 1 AS x FROM users WHERE id = ?', id)) addMember(code, Number(id), 'member');
    }
    return getRoomById(lastInsertRowid);
  });
}

export function updateGroup(code, userId, patch) {
  requireRole(code, userId, ['owner', 'admin']);
  const room = getRoomByCode(code);
  if (!room) throw notFound('房间不存在');
  run(
    'UPDATE rooms SET name = ?, topic = ?, is_public = ?, max_members = ? WHERE code = ?',
    patch.name ?? room.name,
    patch.topic ?? room.topic,
    patch.isPublic === undefined ? room.is_public : patch.isPublic ? 1 : 0,
    patch.maxMembers ?? room.maxMembers,
    code,
  );
  return getRoomByCode(code);
}

export const deleteGroup = (code, userId) => {
  requireRole(code, userId, ['owner']);
  // 消息里的附件置空后随房间级联删除房间，文件本体仍保留在文件模块
  run('UPDATE messages SET attachment_id = NULL WHERE room = ?', code);
  return run('DELETE FROM rooms WHERE code = ?', code).changes > 0;
};

export function addMember(code, userId, role = 'member') {
  if (code === LOBBY) return { room: getRoomByCode(LOBBY) ?? null, added: false };
  const room = getRoomByCode(code);
  if (!room) throw notFound('房间不存在');
  if (!get('SELECT 1 AS x FROM users WHERE id = ?', userId)) throw notFound('用户不存在');
  if (roleOf(code, userId)) return { room, added: false };
  if (room.memberCount >= room.maxMembers) throw badRequest(`房间已满（上限 ${room.maxMembers} 人）`);

  run("INSERT INTO room_members (room_id, user_id, role) VALUES ((SELECT id FROM rooms WHERE code = ?), ?, ?)", code, userId, role);
  const systemMessage = addSystemMessage(code, `${nicknameOf(userId)} 加入了房间`);
  return { room: getRoomByCode(code), added: true, message: systemMessage };
}

export function removeMember(code, userId, targetId) {
  const actorRole = requireRole(code, userId, ['owner', 'admin']);
  const room = getRoomByCode(code);
  if (!room) throw notFound('房间不存在');
  const targetRole = roleOf(code, targetId);
  if (!targetRole) throw notFound('该用户不在房间里');
  if (targetRole === 'owner') throw forbidden('不能移除群主');
  if (actorRole === 'admin' && targetRole === 'admin' && room.ownerId !== userId) throw forbidden('管理员不能移除其他管理员');

  run('DELETE FROM room_members WHERE room_id = (SELECT id FROM rooms WHERE code = ?) AND user_id = ?', code, targetId);
  addSystemMessage(code, `${nicknameOf(targetId)} 离开了房间`);
  return getRoomByCode(code);
}

export const leaveRoom = (code, userId) => {
  if (code === LOBBY) throw badRequest('不能离开大厅');
  const room = getRoomByCode(code);
  if (!room) throw notFound('房间不存在');
  if (roleOf(code, userId) === 'owner') throw forbidden('群主请先转让或解散房间');
  run('DELETE FROM room_members WHERE room_id = (SELECT id FROM rooms WHERE code = ?) AND user_id = ?', code, userId);
  addSystemMessage(code, `${nicknameOf(userId)} 离开了房间`);
  return true;
};

export function setMemberRole(code, actorId, targetId, role) {
  requireRole(code, actorId, ['owner']);
  if (!['admin', 'member'].includes(role)) throw badRequest('角色不合法');
  if (roleOf(code, targetId) === 'owner') throw forbidden('不能修改群主角色');
  const changed = run(
    "UPDATE room_members SET role = ? WHERE room_id = (SELECT id FROM rooms WHERE code = ?) AND user_id = ?",
    role,
    code,
    targetId,
  ).changes;
  if (!changed) throw notFound('该用户不在房间里');
  addSystemMessage(code, `${nicknameOf(targetId)} 的角色已更新`);
  return true;
}

/** 房间成员列表（含在线标记由调用方补）。 */
export function listMembers(code) {
  if (code === LOBBY) {
    return all(
      `SELECT u.id, u.nickname, u.username, u.avatar_hue AS avatarHue, u.title, 'visitor' AS role
         FROM users u ORDER BY u.id LIMIT 100`,
    ).map((row) => ({ ...row, joinedAt: null }));
  }
  return all(
    `SELECT u.id, u.nickname, u.username, u.avatar_hue AS avatarHue, u.title, rm.role,
            rm.joined_at AS joinedAt, rm.last_read AS lastRead
       FROM room_members rm JOIN users u ON u.id = rm.user_id
      WHERE rm.room_id = (SELECT id FROM rooms WHERE code = ?)
      ORDER BY CASE rm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, rm.joined_at`,
    code,
  );
}

export const memberIds = (code) => {
  if (code === LOBBY) return all('SELECT id FROM users').map((row) => row.id);
  return all(
    'SELECT user_id AS id FROM room_members WHERE room_id = (SELECT id FROM rooms WHERE code = ?)',
    code,
  ).map((row) => row.id);
};

const nicknameOf = (userId) => get('SELECT nickname FROM users WHERE id = ?', userId)?.nickname ?? '某人';

/** 房间系统消息（成员变更等）。 */
export const addSystemMessage = (code, body) => addMessage({ room: code, userId: null, nickname: '系统', kind: 'system', body });

/* --------------------------------- 我的房间 --------------------------------- */

/** 我加入的房间 + 全部私聊线程。 */
export function myRooms(userId) {
  const groups = all(
    `SELECT ${ROOM_COLUMNS},
       (SELECT rm.muted FROM room_members rm WHERE rm.room_id = r.id AND rm.user_id = ?) AS muted,
       (SELECT COUNT(*) FROM messages m WHERE m.room = r.code AND m.id > COALESCE((SELECT rm.last_read FROM room_members rm WHERE rm.room_id = r.id AND rm.user_id = ?), 0)) AS unread
       FROM rooms r JOIN room_members rm ON rm.room_id = r.id
      WHERE rm.user_id = ? AND r.type = 'group'
      ORDER BY r.created_at`,
    userId,
    userId,
    userId,
  ).map(shape);

  // 私聊：取出我参与的所有线程，并算出对方是谁
  const threads = all(
    `SELECT t.code AS threadCode, t.user_a AS userA, t.user_b AS userB, r.id, r.name, r.type, r.topic,
            r.owner_id AS ownerId, r.avatar_hue AS avatarHue, r.is_public, r.max_members AS maxMembers,
            r.created_at AS createdAt
       FROM dm_threads t JOIN rooms r ON r.code = t.code
      WHERE t.user_a = ? OR t.user_b = ?
      ORDER BY (SELECT MAX(m.id) FROM messages m WHERE m.room = t.code) DESC`,
    userId,
    userId,
  );

  const dms = threads.map((row) => {
    const peerId = Number(row.userA) === Number(userId) ? row.userB : row.userA;
    return {
      id: row.id,
      code: row.threadCode,
      name: row.name,
      type: 'dm',
      topic: row.topic,
      ownerId: row.ownerId,
      avatarHue: row.avatarHue,
      isPublic: false,
      maxMembers: row.maxMembers,
      createdAt: row.createdAt,
      memberCount: 2,
      messageCount: get('SELECT COUNT(*) AS n FROM messages WHERE room = ?', row.threadCode).n,
      peerId,
      peer: get('SELECT id, nickname, username, avatar_hue AS avatarHue, title FROM users WHERE id = ?', peerId),
      lastMessage: get('SELECT body, kind, created_at AS createdAt FROM messages WHERE room = ? ORDER BY id DESC LIMIT 1', row.threadCode),
      unread: unreadCount(row.threadCode, userId),
      muted: isMuted(row.threadCode, userId),
    };
  });

  return { groups, dms };
}

/** 公开群列表（发现页）。 */
export const discoverGroups = (userId, limit = 30) =>
  all(
    `SELECT ${ROOM_COLUMNS},
       (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id AND rm.user_id = ?) AS joined
       FROM rooms r
      WHERE r.type = 'group' AND r.is_public = 1
      ORDER BY memberCount DESC, r.created_at DESC LIMIT ?`,
    userId,
    limit,
  ).map(shape);

/* ---------------------------------- 私聊 ---------------------------------- */

/** 两人之间的私聊房间；不存在则创建，天然幂等。 */
export function openDm(userId, peerId) {
  if (Number(userId) === Number(peerId)) throw badRequest('不能和自己私聊');
  const peer = get('SELECT id, nickname, username, avatar_hue AS avatarHue, title FROM users WHERE id = ?', peerId);
  if (!peer) throw notFound('用户不存在');

  const [a, b] = [Number(userId), Number(peerId)].sort((x, y) => x - y);
  const code = `dm-${a}-${b}`;
  let room = getRoomByCode(code);
  if (!room) {
    tx(() => {
      const { lastInsertRowid } = run(
        "INSERT INTO rooms (code, name, type, topic, is_public, max_members) VALUES (?, ?, 'dm', ?, 0, 2)",
        code,
        `${nicknameOf(a)} 与 ${nicknameOf(b)}`,
        '私聊',
      );
      run('INSERT INTO dm_threads (code, user_a, user_b) VALUES (?, ?, ?)', code, a, b);
      void lastInsertRowid;
    });
    room = getRoomByCode(code);
  }
  return { room, peer };
}

export const dmPeers = (userId) =>
  all(
    `SELECT u.id, u.nickname, u.username, u.avatar_hue AS avatarHue, u.title,
            (SELECT t.code FROM dm_threads t WHERE (t.user_a = ? AND t.user_b = u.id) OR (t.user_b = ? AND t.user_a = u.id)) AS code
       FROM users u WHERE u.id != ? ORDER BY u.id`,
    userId,
    userId,
    userId,
  );

/** 私聊里的「对方是谁」。若 userId 不是参与者，返回 null（不能泄露会话存在）。 */
export const peerInRoom = (code, userId) => {
  if (!userId) return null;
  const thread = get('SELECT user_a AS a, user_b AS b FROM dm_threads WHERE code = ?', code);
  if (!thread) return null;
  const id = Number(userId);
  if (Number(thread.a) === id) return thread.b;
  if (Number(thread.b) === id) return thread.a;
  return null;
};

/**
 * 标记已读。群聊用 room_members.last_read，私聊用 dm_reads，
 * 大厅没有成员记录所以直接忽略。
 */
/** 房间免打扰（仅成员可设置）。 */
export const setMuted = (code, userId, muted) => {
  if (code === LOBBY) throw badRequest('大厅不支持免打扰');
  const changed = run(
    'UPDATE room_members SET muted = ? WHERE user_id = ? AND room_id = (SELECT id FROM rooms WHERE code = ?)',
    muted ? 1 : 0,
    userId,
    code,
  ).changes;
  if (!changed) throw notFound('你不是该房间成员');
  return muted;
};

export const isMuted = (code, userId) =>
  Boolean(get('SELECT muted FROM room_members WHERE user_id = ? AND room_id = (SELECT id FROM rooms WHERE code = ?)', userId, code)?.muted);

/** 我设置过免打扰的房间码集合。 */
export const mutedRoomsOf = (userId) =>
  all('SELECT r.code FROM room_members rm JOIN rooms r ON r.id = rm.room_id WHERE rm.user_id = ? AND rm.muted = 1', userId)
    .map((row) => row.code);

export const markRead = (code, userId) => {
  if (!userId || code === LOBBY) return true;
  const room = getRoomByCode(code);
  if (room?.type === 'group') {
    run(
      "UPDATE room_members SET last_read = datetime('now') WHERE user_id = ? AND room_id = (SELECT id FROM rooms WHERE code = ?)",
      userId,
      code,
    );
    return true;
  }
  if (room?.type === 'dm') {
    run(
      `INSERT INTO dm_reads (thread_id, user_id, last_read)
       VALUES ((SELECT id FROM dm_threads WHERE code = ?), ?, (SELECT COALESCE(MAX(m.id), 0) FROM messages m WHERE m.room = ?))
       ON CONFLICT(thread_id, user_id) DO UPDATE SET last_read = excluded.last_read`,
      code,
      userId,
      code,
    );
  }
  return true;
};

export const unreadCount = (code, userId) =>
  get(
    "SELECT COUNT(*) AS n FROM messages WHERE room = ? AND user_id IS NOT ? AND user_id != ? AND id > COALESCE((SELECT last_read FROM room_members WHERE room_id = (SELECT id FROM rooms WHERE code = ?) AND user_id = ?), 0)",
    code,
    userId,
    userId,
    code,
    userId,
  ).n;
