import { notFound, badRequest, forbidden } from '../lib/http-error.js';
import { createLimiter } from '../lib/rate-limit.js';
import { str, bool, int, oneOf } from '../lib/validate.js';
import * as rooms from '../models/rooms.js';
import * as chat from '../models/chat.js';
import { get } from '../db.js';
import * as files from '../models/files.js';
import { getFile } from '../models/files.js';
import { findNickname as lookupNickname } from '../models/users.js';
import { recordEvent } from '../models/stats.js';
import { broadcastToRoom } from '../ws/chat.js';

const roomLimiter = createLimiter({ windowMs: 60_000, max: 20, name: 'room' });

const nicknameOf = (userId) => lookupNickname(userId);

/** 房间存在性与可见性：大厅和公开群任何人可读，私密群/私聊必须是成员。 */
function assertVisible(code, user) {
  const room = rooms.getRoomByCode(code);
  if (!room && code !== 'lobby') throw notFound('房间不存在');
  if (room?.isPublic || code === 'lobby') return room;
  if (!user || !rooms.isMember(code, user.id)) throw forbidden('你不是该房间成员');
  return room;
}

export function registerRooms(router) {
  /* ------------------------------- 房间读取 ------------------------------- */

  router.get('/api/rooms', async (ctx) => {
    const user = ctx.requireUser();
    ctx.json(200, { ...rooms.myRooms(user.id), muted: rooms.mutedRoomsOf(user.id) });
  });

  router.get('/api/rooms/discover', async (ctx) => {
    ctx.json(200, { items: rooms.discoverGroups(ctx.user?.id ?? 0) });
  });

  router.get('/api/rooms/:code/messages', async (ctx) => {
    const code = ctx.params.code;
    assertVisible(code, ctx.user);
    const items = chat.listMessages(code, {
      limit: int(ctx.query.limit, '数量', { min: 1, max: 200, fallback: 50 }),
      beforeId: ctx.query.before ? int(ctx.query.before, '游标', { min: 1 }) : null,
      afterId: ctx.query.after ? int(ctx.query.after, '游标', { min: 1 }) : null,
    });
    ctx.json(200, {
      items,
      room: rooms.getRoomByCode(code),
      pinned: chat.pinnedMessage(code),
      oldestId: chat.oldestIdIn(code),
      // 翻页时表示「这一页之后还有更早的」；首屏则表示「一屏没装下全部」
      hasMore: ctx.query.before ? items.length === limit : chat.messageCount(code) > items.length,
    });
  });

  /** 房间内消息搜索：只搜当前房间。 */
  router.get('/api/rooms/:code/search', async (ctx) => {
    const code = ctx.params.code;
    assertVisible(code, ctx.user);
    const result = chat.searchMessages(code, ctx.query.q ?? '', { limit: int(ctx.query.limit, '数量', { min: 1, max: 100, fallback: 30 }) });
    ctx.json(200, result);
  });

  /** 置顶房间公告（同一房间只保留一条）。 */
  router.post('/api/rooms/:code/pin', async (ctx) => {
    const user = ctx.requireUser();
    const code = ctx.params.code;
    if (!rooms.roleOf(code, user.id)) throw forbidden('只有成员或管理员可以置顶公告');
    const body = await ctx.input();
    const target = get('SELECT id, room FROM messages WHERE id = ?', int(body.messageId, '消息', { min: 1 }));
    if (!target) throw notFound('消息不存在');
    if (target.room !== code) throw badRequest('该消息不属于当前房间');

    const pinned = chat.pinMessage(target.id);
    broadcastToRoom(code, { type: 'pinned', room: code, pinned });
    ctx.json(200, { pinned });
  });

  router.delete('/api/rooms/:code/pin', async (ctx) => {
    const user = ctx.requireUser();
    const code = ctx.params.code;
    if (!rooms.roleOf(code, user.id)) throw forbidden('只有成员或管理员可以取消置顶');
    const current = chat.pinnedMessage(code);
    if (!current) return ctx.json(200, { pinned: null });
    chat.unpinMessage(current.id);
    broadcastToRoom(code, { type: 'pinned', room: code, pinned: null });
    ctx.json(200, { pinned: null });
  });

  /** 免打扰。 */
  router.post('/api/rooms/:code/mute', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    const muted = rooms.setMuted(ctx.params.code, user.id, body.muted !== false);
    broadcastToRoom(ctx.params.code, { type: 'mute', room: ctx.params.code, userId: user.id, muted });
    ctx.json(200, { muted });
  });

  router.get('/api/rooms/:code/members', async (ctx) => {
    const code = ctx.params.code;
    const room = assertVisible(code, ctx.user);
    ctx.json(200, {
      items: rooms.listMembers(code),
      room,
      myRole: ctx.user ? rooms.roleOf(code, ctx.user.id) : null,
    });
  });

  /* -------------------------------- 建群管理 -------------------------------- */

  router.post('/api/rooms', async (ctx) => {
    const user = ctx.requireUser();
    if (roomLimiter.take(user.id)) throw badRequest('建群太频繁了，稍后再试');
    const body = await ctx.input();
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds.map(Number).filter(Boolean) : [];
    const room = rooms.createGroup(user.id, {
      name: str(body.name, '群名称', { max: 40 }),
      topic: str(body.topic, '群简介', { max: 200, required: false, fallback: '' }),
      isPublic: bool(body.isPublic, true),
      maxMembers: int(body.maxMembers, '人数上限', { min: 2, max: 200, fallback: 50 }),
      memberIds,
    });
    recordEvent(user.id, 'chat.create-room', room.name);
    ctx.json(201, { room });
  });

  router.patch('/api/rooms/:code', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    const room = rooms.updateGroup(ctx.params.code, user.id, {
      name: body.name === undefined ? undefined : str(body.name, '群名称', { max: 40 }),
      topic: body.topic === undefined ? undefined : str(body.topic, '群简介', { max: 200, required: false, fallback: '' }),
      isPublic: body.isPublic === undefined ? undefined : bool(body.isPublic),
      maxMembers: body.maxMembers === undefined ? undefined : int(body.maxMembers, '人数上限', { min: 2, max: 200 }),
    });
    broadcastToRoom(room.code, { type: 'room-update', room });
    ctx.json(200, { room });
  });

  router.delete('/api/rooms/:code', async (ctx) => {
    const user = ctx.requireUser();
    if (!rooms.deleteGroup(ctx.params.code, user.id)) throw notFound('房间不存在');
    recordEvent(user.id, 'chat.delete-room', '解散群聊');
    broadcastToRoom(ctx.params.code, { type: 'room-closed', room: ctx.params.code });
    ctx.json(200, { ok: true });
  });

  /* -------------------------------- 成员管理 -------------------------------- */

  router.post('/api/rooms/:code/join', async (ctx) => {
    const user = ctx.requireUser();
    const room = rooms.getRoomByCode(ctx.params.code);
    if (!room) throw notFound('房间不存在');
    const result = rooms.addMember(room.code, user.id, 'member');
    if (result.added) broadcastToRoom(room.code, { type: 'members-changed', room: room.code });
    ctx.json(200, { room: result.room, joined: result.added });
  });

  /** 拉人：成员及以上权限即可邀请。 */
  router.post('/api/rooms/:code/members', async (ctx) => {
    const actor = ctx.requireUser();
    const code = ctx.params.code;
    if (code !== 'lobby' && !rooms.roleOf(code, actor.id)) throw forbidden('你不是该房间成员');

    const body = await ctx.input();
    const targets = (Array.isArray(body.userIds) ? body.userIds : [body.userId]).map(Number).filter(Number.isFinite);
    const added = [];
    for (const targetId of targets) {
      if (rooms.addMember(code, targetId, 'member').added) added.push(targetId);
    }
    if (added.length) {
      const names = added.map((id) => nicknameOf(id)).filter(Boolean).join('、');
      broadcastToRoom(code, {
        type: 'message',
        room: code,
        message: chat.addMessage({ room: code, userId: null, nickname: '系统', kind: 'system', body: `${actor.nickname} 邀请 ${names} 加入了房间` }),
      });
      broadcastToRoom(code, { type: 'members-changed', room: code });
    }
    ctx.json(200, { added, room: rooms.getRoomByCode(code) });
  });

  router.patch('/api/rooms/:code/members/:userId', async (ctx) => {
    const actor = ctx.requireUser();
    const body = await ctx.input();
    rooms.setMemberRole(ctx.params.code, actor.id, Number(ctx.params.userId), oneOf(body.role, '角色', ['admin', 'member']));
    broadcastToRoom(ctx.params.code, { type: 'members-changed', room: ctx.params.code });
    ctx.json(200, { ok: true });
  });

  router.delete('/api/rooms/:code/members/:userId', async (ctx) => {
    const actor = ctx.requireUser();
    const room = rooms.removeMember(ctx.params.code, actor.id, Number(ctx.params.userId));
    broadcastToRoom(ctx.params.code, { type: 'members-changed', room: ctx.params.code });
    ctx.json(200, { room });
  });

  router.post('/api/rooms/:code/leave', async (ctx) => {
    const user = ctx.requireUser();
    rooms.leaveRoom(ctx.params.code, user.id);
    broadcastToRoom(ctx.params.code, { type: 'members-changed', room: ctx.params.code });
    ctx.json(200, { ok: true });
  });

  /** 已读回执：标记这些消息我看过。 */
  router.post('/api/rooms/:code/seen', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    const ids = (Array.isArray(body.messageIds) ? body.messageIds : [body.messageId]).map(Number).filter(Number.isFinite);
    for (const id of ids) chat.markRead(id, user.id);
    ctx.json(200, { ok: true, count: ids.length });
  });

  router.get('/api/messages/:id/reads', async (ctx) => {
    const user = ctx.requireUser();
    const message = chat.messageAuthor(Number(ctx.params.id));
    if (!message) throw notFound('消息不存在');
    if (!rooms.isMember(message.room, user.id)) throw forbidden('你不是该房间成员');
    ctx.json(200, { readers: chat.readersOf(message.id) });
  });

  router.post('/api/rooms/:code/read', async (ctx) => {
    const user = ctx.requireUser();
    rooms.markRead(ctx.params.code, user.id);
    ctx.json(200, { ok: true });
  });

  /* --------------------------------- 私聊 --------------------------------- */

  router.get('/api/dms', async (ctx) => {
    const user = ctx.requireUser();
    const data = rooms.myRooms(user.id);
    ctx.json(200, { peers: rooms.dmPeers(user.id), threads: data.dms });
  });

  router.post('/api/dms', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    const { room, peer } = rooms.openDm(user.id, int(body.userId, '对方用户', { min: 1 }));
    ctx.json(200, { room, peer, messages: chat.listMessages(room.code, { limit: 50 }) });
  });

  /**
   * 聊天附件下载：附件挂在消息上，只有「发件人本人」或「该房间成员」能下，
   * 避免群里的文件被当成公开图床。
   */
  router.get('/api/attachments/:fileId', async (ctx) => {
    const user = ctx.requireUser();
    const message = chat.findMessageByAttachment(Number(ctx.params.fileId));
    if (!message) throw notFound('附件不存在');
    if (message.userId !== user.id && !rooms.isMember(message.room, user.id)) {
      throw forbidden('你不是该会话的成员，无法下载此文件');
    }
    const file = getFile(Number(ctx.params.fileId), message.userId);
    if (!file) throw notFound('文件已被删除');
    files.registerDownload(file.id);
    ctx.download(files.resolveStoredPath(file.storedName), file.name, file.mime);
  });
}
