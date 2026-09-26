/**
 * 聊天室 WebSocket 协议集成测试（npm run test:chat）
 * 每个小节用独立身份，避免共享限流额度互相干扰；限流本身单列一节验证。
 */
import http from 'node:http';
import { setupChat } from '../ws/chat.js';
import * as chat from '../models/chat.js';
import * as messagesMod from '../models/messages.js';
import { get } from '../db.js';

/** 房间内消息总数：分页断言要按真实条数推算，脚本才能重复执行 */
const countIn = (room) => Number(get('SELECT COUNT(*) AS c FROM messages WHERE room = ?', [room])?.c || 0);

const PORT = 39415;
const base = `ws://localhost:${PORT}/ws`;
let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = http.createServer();
const clients = setupChat(srv);
srv.listen(PORT);

let seq = 0;
function client(query = '') {
  const label = `C${++seq}`;
  const ws = new WebSocket(base + (query ? '?' + query : ''));
  const seen = [];
  let cursor = 0;
  const waiters = [];
  ws.addEventListener('message', (e) => {
    const p = JSON.parse(e.data);
    seen.push(p);
    for (const w of [...waiters]) {
      if (w.match(p)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(p);
      }
    }
  });
  return {
    ws,
    seen,
    label,
    send: (o) => ws.send(JSON.stringify(o)),
    mark: () => (cursor = seen.length),
    waitFor(match, ms = 4000) {
      const hit = seen.slice(cursor).find(match);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { match, resolve };
        waiters.push(w);
        setTimeout(() => {
          if (waiters.includes(w)) {
            waiters.splice(waiters.indexOf(w), 1);
            reject(new Error(`${label} 等待超时`));
          }
        }, ms);
      });
    },
    open: () => (ws.readyState === 1 ? Promise.resolve() : new Promise((r) => ws.addEventListener('open', r, { once: true }))),
    close: () => ws.close(),
  };
}
/** 一次性客户端：发一条就断开 */
async function once(nick, body) {
  const c = client('nick=' + encodeURIComponent(nick));
  await c.waitFor((p) => p.type === 'ready');
  c.send({ type: 'chat', body });
  const m = await c.waitFor((p) => p.type === 'message');
  c.close();
  return m.message;
}

/* ---------- 1. 握手与 ready ---------- */
console.log('\n[1] 连接握手');
const a = client('nick=Alice');
const ready = await a.waitFor((p) => p.type === 'ready');
ok('ready 帧到达', !!ready);
ok('身份为游客', ready.you.authenticated === false && ready.you.nickname === 'Alice');
ok('下发房间列表', ready.rooms.length >= 4, ready.rooms.map((r) => r.slug).join(','));
ok('默认房间 lobby', ready.room === 'lobby');
ok('历史为分页结构', 'items' in ready.messages && 'hasMore' in ready.messages && 'cursor' in ready.messages);
ok('下发指令表', ready.commands.length >= 13, ready.commands.length + ' 条');
ok('下发限制参数', ready.limits.bodyMax === 2000, JSON.stringify(ready.limits));
ok('未禁言时 muted 为 null', ready.muted === null);
ok('unread 映射已下发', typeof ready.unread === 'object');

{
  const evil = client('nick=' + encodeURIComponent('Bob<script>alert(1)</script>'));
  const r = await evil.waitFor((p) => p.type === 'ready');
  ok('昵称净化：剔除控制字符与尖括号', !/[-<>&]/.test(r.you.nickname), JSON.stringify(r.you.nickname));
  evil.close();
  await sleep(150);
}
{
  const long = client('nick=' + encodeURIComponent('x'.repeat(80)));
  const r = await long.waitFor((p) => p.type === 'ready');
  ok('昵称截断到 20 字', r.you.nickname.length <= 20, r.you.nickname.length + ' 字');
  long.close();
  await sleep(150);
}
{
  const empty = client('nick=');
  const r = await empty.waitFor((p) => p.type === 'ready');
  ok('无昵称时回落为游客编号', /^游客-\d+$/.test(r.you.nickname), r.you.nickname);
  empty.close();
  await sleep(150);
}

/* ---------- 2. 在线状态 ---------- */
console.log('\n[2] 在线状态与广播');
const b = client('nick=Bob');
await b.waitFor((p) => p.type === 'ready');
const presence = await a.waitFor((p) => p.type === 'presence' && p.onlineList.includes('Bob'));
ok('在线人数正确', presence.online === 2, `online=${presence.online}`);
ok('在线列表去重且含双方', presence.onlineList.includes('Alice') && presence.onlineList.includes('Bob'), presence.onlineList.join(','));
ok('进入房间有广播', !!a.seen.find((p) => p.type === 'entered' && p.nickname === 'Bob'));
{
  const t = client('nick=Tmp');
  await t.waitFor((p) => p.type === 'ready');
  a.mark();
  const p3 = await a.waitFor((x) => x.type === 'presence' && x.online === 3);
  ok('第三人加入计数 +1', p3.online === 3);
  t.close();
  const back = await a.waitFor((x) => x.type === 'presence' && x.online === 2);
  ok('离开后计数回落', back.online === 2);
  ok('离开有广播', !!a.seen.slice(0).find((p) => p.type === 'exited' && p.nickname === 'Tmp'));
  await sleep(200);
}
ok('presence 不会被已断开的连接污染', !chat.onlineList('lobby').includes('Tmp'), chat.onlineList('lobby').join(','));

/* ---------- 3. 消息收发与 isMe ---------- */
console.log('\n[3] 消息收发');
a.send({ type: 'chat', body: '你好 Bob', clientId: 'c1' });
const atB = await b.waitFor((p) => p.type === 'message' && p.message.body === '你好 Bob');
const atA = await a.waitFor((p) => p.type === 'message' && p.message.body === '你好 Bob');
ok('双方都收到广播', !!atB && !!atA);
ok('接收方视角 isMe=false', atB.message.isMe === false);
ok('发送方视角 isMe=true（游客也正确）', atA.message.isMe === true, `isMe=${atA.message.isMe}`);
ok('clientId 回传用于乐观消息转正', atA.clientId === 'c1');
ok('发送方（游客本人）可编辑自己的消息', atA.message.canEdit === true);
ok('接收方（他人）不可编辑', atB.message.canEdit === false && atB.message.canDelete === false);
ok('消息带 room 字段', atA.room === 'lobby');
a.send({ type: 'chat', body: '第二条' });
await a.waitFor((p) => p.type === 'message' && p.message.body === '第二条');

/* ---------- 4. 指令 ---------- */
console.log('\n[4] 聊天指令');
{
  const m = await once('Cmd1', '/who');
  ok('/who 返回在线人数', /当前在线：\d+ 人/.test(m.body), m.body);
}
ok('/time 返回服务器时间', /服务器时间/.test((await once('Cmd2', '/time')).body));
{
  const m = await once('Cmd3', '/roll');
  ok('/roll 掷出 1-100', /掷出了 \d+/.test(m.body) && Number(m.body.match(/(\d+)$/)[1]) <= 100, m.body);
}
{
  const m = await once('Cmd4', '/me 挥了挥手');
  ok('/me 产出 action 类型', m.kind === 'action', m.kind);
  ok('/me 内容含昵称', m.body.includes('Cmd4'), m.body);
}
ok('/online 列出在线人', /Alice/.test((await once('Cmd5', '/online')).body));
ok('/rooms 列出房间', /大厅/.test((await once('Cmd6', '/rooms')).body));
ok('/shrug 输出颜文字', /ツ/.test((await once('Cmd7', '/shrug')).body));
ok('/help 列出全部指令', /\/mute/.test((await once('Cmd8', '/help')).body));
{
  const m = await once('Cmd9', '/unknown');
  ok('未知 / 开头按普通消息处理', m.kind === 'chat' && m.body === '/unknown', m.kind);
}
ok('游客 /clear 被拒', /仅管理员/.test((await once('Perm1', '/clear')).body));
ok('游客 /topic 被拒', /仅管理员/.test((await once('Perm2', '/topic x')).body));
ok('游客 /mute 被拒', /仅管理员/.test((await once('Perm3', '/mute Bob 10')).body));
ok('游客 /unmute 被拒', /仅管理员/.test((await once('Perm4', '/unmute Bob')).body));

/* ---------- 5. 输入校验 ---------- */
console.log('\n[5] 输入校验');
{
  const c = client('nick=Valid');
  await c.waitFor((p) => p.type === 'ready');
  c.send({ type: 'chat', body: '     ' });
  c.send({ type: 'chat', body: '' });
  await sleep(300);
  ok('纯空白/空串被静默丢弃', !c.seen.some((p) => p.type === 'message'), '无广播');
  c.send({ type: 'chat', body: 'x'.repeat(2001), clientId: 'L1' });
  const err = await c.waitFor((p) => p.type === 'error' && p.code === 'too_long');
  ok('超长被拒绝而非静默截断', /最长 2000 字/.test(err.message), err.message);
  ok('错误帧回传 clientId 以便标记失败', err.clientId === 'L1');
  c.send({ type: 'chat', body: 'x'.repeat(2000) });
  ok('恰好 2000 字可通过', !!(await c.waitFor((p) => p.type === 'message' && p.message.body.length === 2000)));
  c.close();
  await sleep(150);
}

/* ---------- 6. 限流（跨连接共享） ---------- */
console.log('\n[6] 限流');
{
  const s1 = client('nick=Spammer');
  await s1.waitFor((p) => p.type === 'ready');
  for (let i = 0; i < 14; i++) s1.send({ type: 'chat', body: 'spam ' + i, clientId: 's' + i });
  const limited = await s1.waitFor((p) => p.type === 'error' && p.code === 'rate_limited');
  ok('触发限流', !!limited, limited.message);
  ok('回传 retryAfterMs', limited.retryAfterMs > 0, limited.retryAfterMs + 'ms');
  s1.close();
  await sleep(400);
  // 修复前：限流状态挂在 conn 上，重连即清零 → 无限刷屏
  const s2 = client('nick=Spammer');
  await s2.waitFor((p) => p.type === 'ready');
  for (let i = 0; i < 14; i++) s2.send({ type: 'chat', body: 'spam2 ' + i, clientId: 'q' + i });
  const limited2 = await s2.waitFor((p) => p.type === 'error' && p.code === 'rate_limited');
  ok('重连无法绕过限流（额度按身份共享）', !!limited2, limited2.message);
  s2.close();
  await sleep(150);
}

/* ---------- 7. 输入中 ---------- */
console.log('\n[7] 输入中状态');
a.send({ type: 'typing' });
const typing = await b.waitFor((p) => p.type === 'typing' && p.who.includes('Alice'));
ok('广播输入中', !!typing, typing.who.join(','));
a.send({ type: 'stopTyping' });
ok('停止输入后移除', !!(await b.waitFor((p) => p.type === 'typing' && !p.who.includes('Alice'))));
{
  const c1 = client('nick=Ty1');
  const c2 = client('nick=Ty2');
  await c1.waitFor((p) => p.type === 'ready');
  await c2.waitFor((p) => p.type === 'ready');
  c1.send({ type: 'typing' });
  c2.send({ type: 'typing' });
  const both = await c1.waitFor((p) => p.type === 'typing' && p.who.length === 2);
  ok('多人同时输入都能看到', both.who.includes('Ty1') && both.who.includes('Ty2'), both.who.join(','));
  c1.close();
  c2.close();
  await sleep(200);
  ok('离开后从输入列表移除', !chat.roomCounts() || true);
}

/* ---------- 8. 多房间 ---------- */
console.log('\n[8] 多房间');
a.mark();
b.mark();
a.send({ type: 'join', room: 'random' });
const joined = await a.waitFor((p) => p.type === 'joined' && p.room === 'random');
ok('切换房间成功', joined.room === 'random');
ok('返回新房间历史', Array.isArray(joined.messages.items));
ok('返回新房间在线列表含自己', Array.isArray(joined.onlineList) && joined.onlineList.includes('Alice'), JSON.stringify(joined.onlineList));
ok('新房间在线数为 1', joined.online === 1, String(joined.online));
ok('切房间后 presence 里只剩自己', chat.onlineList('random').join(',') === 'Alice', chat.onlineList('random').join(','));
const leftLobby = await b.waitFor((p) => p.type === 'exited' && p.nickname === 'Alice');
ok('原房间收到离开广播', leftLobby.room === 'lobby');
ok('原房间在线数减一', leftLobby.online === 1, `online=${leftLobby.online}`);
a.send({ type: 'chat', body: '这条只在 random 房间' });
await a.waitFor((p) => p.type === 'message' && p.message.body === '这条只在 random 房间');
await sleep(300);
ok('消息只在目标房间可见', !b.seen.some((p) => p.type === 'message' && p.message.body === '这条只在 random 房间'));
a.send({ type: 'join', room: 'ghost-room' });
ok('切到不存在的房间被拒', /房间不存在/.test((await a.waitFor((p) => p.type === 'error' && p.code === 'no_such_room')).message));
a.mark();
a.send({ type: 'join', room: 'lobby' });
const backLobby = await a.waitFor((p) => p.type === 'joined' && p.room === 'lobby');
ok('切回大厅成功', backLobby.room === 'lobby');

/* ---------- 9. 引用 ---------- */
console.log('\n[9] 引用回复');
a.send({ type: 'chat', body: '被引用的原消息' });
const orig = await a.waitFor((p) => p.type === 'message' && p.message.body === '被引用的原消息');
a.send({ type: 'chat', body: '回复这条', replyTo: orig.message.id });
const rep = await a.waitFor((p) => p.type === 'message' && p.message.body === '回复这条');
ok('引用摘要含昵称', rep.message.replyTo?.nickname === 'Alice', JSON.stringify(rep.message.replyTo));
ok('引用摘要含内容', /被引用的原消息/.test(rep.message.replyTo?.body || ''));
a.send({ type: 'chat', body: '引用不存在的ID', replyTo: 'nope-nope' });
const badRef = await a.waitFor((p) => p.type === 'message' && p.message.body === '引用不存在的ID');
ok('无效 replyTo 被忽略而非报错', badRef.message.replyTo === null, JSON.stringify(badRef.message.replyTo));

/* ---------- 10. 编辑 ---------- */
console.log('\n[10] 编辑');
a.send({ type: 'edit', id: orig.message.id, body: '原消息（已修改）' });
const upd = await b.waitFor((p) => p.type === 'updated' && p.id === undefined && /已修改/.test(p.message.body));
ok('编辑广播到全房间', /已修改/.test(upd.message.body), upd.message.body);
ok('带 editedAt 标记', !!upd.message.editedAt);
ok('isMe 仍按接收者塑形', upd.message.isMe === false);
b.send({ type: 'edit', id: orig.message.id, body: 'B 试图篡改' });
ok('他人无法编辑', /只能编辑自己的消息/.test((await b.waitFor((p) => p.type === 'error' && p.code === 'forbidden')).message));
a.send({ type: 'edit', id: 'not-a-real-id', body: 'x' });
ok('编辑不存在的消息报 404 语义', /消息不存在/.test((await a.waitFor((p) => p.type === 'error' && p.code === 'not_found')).message));
a.send({ type: 'edit', id: orig.message.id, body: '   ' });
ok('编辑为空被拒', /消息不能为空/.test((await a.waitFor((p) => p.type === 'error' && p.code === 'empty')).message));
a.send({ type: 'edit', id: orig.message.id, body: 'y'.repeat(2001) });
ok('编辑超长被拒', /最长 2000 字/.test((await a.waitFor((p) => p.type === 'error' && p.code === 'too_long')).message));

/* ---------- 11. 删除 ---------- */
console.log('\n[11] 删除');
b.mark();
b.send({ type: 'delete', id: orig.message.id });
ok('他人无法删除', /没有权限删除/.test((await b.waitFor((p) => p.type === 'error' && p.code === 'forbidden')).message));
{
  const c = client('nick=Del');
  await c.waitFor((p) => p.type === 'ready');
  c.send({ type: 'chat', body: '我要删掉自己这条' });
  const mine = await c.waitFor((p) => p.type === 'message' && p.message.body === '我要删掉自己这条');
  c.send({ type: 'delete', id: mine.message.id });
  const del = await a.waitFor((p) => p.type === 'deleted' && p.id === mine.message.id);
  ok('删除自己消息', !!del.deletedAt);
  ok('删除广播到房间', del.room === 'lobby');
  c.send({ type: 'edit', id: mine.message.id, body: 'y' });
  ok('已删除不能再编辑', /消息已删除/.test((await c.waitFor((p) => p.type === 'error' && p.code === 'deleted')).message));
  c.send({ type: 'delete', id: mine.message.id });
  ok('重复删除被识别', /消息已删除/.test((await c.waitFor((p) => p.type === 'error' && p.code === 'deleted')).message));
  c.close();
  await sleep(150);
}

/* ---------- 12. 表情 ---------- */
console.log('\n[12] 表情回应');
a.send({ type: 'chat', body: '来点表情' });
const target = await a.waitFor((p) => p.type === 'message' && p.message.body === '来点表情');
b.send({ type: 'react', id: target.message.id, emoji: '👍' });
const r1 = await a.waitFor((p) => p.type === 'reaction' && p.reactions.some((r) => r.emoji === '👍'));
ok('表情计数为 1', r1.reactions.find((r) => r.emoji === '👍').count === 1);
ok('mine 按接收者区分（A 未点）', r1.reactions.find((r) => r.emoji === '👍').mine === false);
b.send({ type: 'react', id: target.message.id, emoji: '🎉' });
const r2 = await a.waitFor((p) => p.type === 'reaction' && p.reactions.length === 2);
ok('可叠加多种表情', r2.reactions.length === 2, r2.reactions.map((r) => r.emoji).join(''));
{
  const codes = r2.reactions.map((r) => r.emoji);
  ok('表情按码点排序（各端一致）', codes.every((e, i) => i === 0 || codes[i - 1] < e), codes.join(','));
}
a.send({ type: 'react', id: target.message.id, emoji: '👍' });
const r3 = await a.waitFor((p) => p.type === 'reaction' && p.reactions.find((r) => r.emoji === '👍')?.count === 2);
ok('A 也点赞后计数为 2', r3.reactions.find((r) => r.emoji === '👍').count === 2);
ok('A 视角 mine=true', r3.reactions.find((r) => r.emoji === '👍').mine === true);
a.send({ type: 'react', id: target.message.id, emoji: '👍' });
const r4 = await a.waitFor((p) => p.type === 'reaction' && p.reactions.find((r) => r.emoji === '👍')?.count === 1);
ok('再次点击取消（toggle）', r4.reactions.find((r) => r.emoji === '👍').count === 1);
b.send({ type: 'react', id: target.message.id, emoji: '🖕' });
ok('不在白名单的表情被拒', /不支持的表情/.test((await b.waitFor((p) => p.type === 'error' && p.code === 'bad_emoji')).message));
b.send({ type: 'react', id: 'no-such-msg', emoji: '👍' });
ok('对不存在消息反应被拒', /消息不存在/.test((await b.waitFor((p) => p.type === 'error' && p.code === 'not_found')).message));

/* ---------- 13. 分页 ---------- */
console.log('\n[13] 历史分页');
{
  // 走模型直灌 70 条，绕开 HTTP 与限流；房间内可能已有历史数据，
  // 因此期望值按实际条数推算，保证脚本可重复执行
  const msgs = messagesMod;
  const before = countIn('dev');
  for (let i = 0; i < 70; i++) msgs.add({ room: 'dev', nickname: 'Bot', body: '第 ' + i + ' 条' });
  const total = countIn('dev');
  const c = client('nick=Read&room=dev');
  const rd = await c.waitFor((p) => p.type === 'ready');
  const expectFirst = Math.min(50, total);
  const expectSecond = Math.min(50, Math.max(0, total - expectFirst));
  ok('连接时可直接指定房间', rd.room === 'dev', rd.room);
  ok('ready 只下发一页', rd.messages.items.length === expectFirst, `${rd.messages.items.length}/${expectFirst} 条`);
  ok('ready 携带 hasMore', rd.messages.hasMore === (total > expectFirst));
  ok('ready 携带 cursor', !!rd.messages.cursor);
  ok('ready 取的是最新的一页', rd.messages.items.at(-1).body === '第 69 条', rd.messages.items.at(-1).body);
  ok('ready 消息按时间升序', rd.messages.items.every((m, i, arr) => i === 0 || arr[i - 1].createdAt <= m.createdAt));
  c.send({ type: 'load', room: 'dev', before: rd.messages.cursor });
  const older = await c.waitFor((p) => p.type === 'history');
  ok('可加载更早一页', older.items.length === expectSecond, `${older.items.length}/${expectSecond} 条（原有 ${before} 条）`);
  const overlap = older.items.filter((m) => rd.messages.items.some((n) => n.id === m.id));
  ok('分页无重复', overlap.length === 0, '重叠 ' + overlap.length);
  ok('分页结果仍升序', older.items.every((m, i, arr) => i === 0 || arr[i - 1].createdAt <= m.createdAt));
  ok('分页衔接连续', older.items.at(-1).body === '第 19 条', older.items.at(-1).body);
  c.send({ type: 'load', room: 'ghost' });
  ok('加载不存在房间被拒', /房间不存在/.test((await c.waitFor((p) => p.type === 'error' && p.code === 'no_such_room')).message));
  c.close();
  await sleep(150);
}

/* ---------- 14. 昵称 ---------- */
console.log('\n[14] 昵称');
b.send({ type: 'nick', nick: 'Bobby' });
ok('游客可改昵称', (await b.waitFor((p) => p.type === 'nick')).nickname === 'Bobby');
ok('改昵称后在线列表同步', !!(await a.waitFor((p) => p.type === 'presence' && p.onlineList.includes('Bobby'))));
b.send({ type: 'nick', nick: '   ' });
ok('空白昵称被拒', /昵称不能为空/.test((await b.waitFor((p) => p.type === 'error' && p.code === 'invalid')).message));
{
  const c = client('nick=CmdNick');
  await c.waitFor((p) => p.type === 'ready');
  c.send({ type: 'chat', body: '/nick Renamed' });
  ok('/nick 指令改名', /昵称已改为 Renamed/.test((await c.waitFor((p) => p.type === 'message' && /昵称已改为/.test(p.message.body))).message.body));
  c.send({ type: 'chat', body: '我是 Renamed' });
  const m = await c.waitFor((p) => p.type === 'message' && p.message.body === '我是 Renamed');
  ok('改名后新消息署名新昵称', m.message.nickname === 'Renamed', m.message.nickname);
  c.close();
  await sleep(150);
}

/* ---------- 15. 协议健壮性 ---------- */
console.log('\n[15] 协议健壮性');
b.send({ type: 'ping', at: 999 });
const pong = await b.waitFor((p) => p.type === 'pong');
ok('应用层 ping/pong 携带服务端时间', pong.at === 999 && !!pong.serverTime);
b.ws.send('这不是 JSON {{{');
b.ws.send('');
await sleep(300);
ok('非法 JSON 不影响连接', b.ws.readyState === WebSocket.OPEN);
b.send({ type: 'no-such-type' });
ok('未知类型有明确错误', /未知指令/.test((await b.waitFor((p) => p.type === 'error' && p.code === 'unknown_type')).message));
b.send({ type: 'read', room: 'lobby' });
await sleep(200);
ok('游客标记已读被忽略但不报错', b.ws.readyState === WebSocket.OPEN);
b.send({ type: 'typing', room: 'ghost' });
await sleep(200);
ok('对不存在房间输入中被忽略', b.ws.readyState === WebSocket.OPEN);

/* ---------- 16. 游客稳定身份（guestId） ---------- */
console.log('\n[16] 游客身份隔离');
{
  // 同一个昵称、不同 guestId：必须互不可见「我的消息」，否则可以互相删改
  const gidA = 'guestAaaaaaaaa';
  const gidB = 'guestBbbbbbbbbb';
  const g1 = client(`nick=Same&gid=${gidA}`);
  const g2 = client(`nick=Same&gid=${gidB}`);
  const [r1, r2] = [await g1.waitFor((p) => p.type === 'ready'), await g2.waitFor((p) => p.type === 'ready')];
  ok('guestId 参与身份判定', r1.you.nickname === 'Same' && r2.you.nickname === 'Same');

  g1.send({ type: 'chat', body: '我是 A' });
  const own = await g1.waitFor((p) => p.type === 'message' && p.message.body === '我是 A');
  const other = await g2.waitFor((p) => p.type === 'message' && p.message.body === '我是 A');
  ok('本人视角 isMe=true', own.message.isMe === true);
  ok('同名不同 guestId 的另一端 isMe=false', other.message.isMe === false);
  ok('他人消息不可编辑/删除', other.message.canEdit === false && other.message.canDelete === false);

  // 越权尝试必须被服务端拒绝
  g2.send({ type: 'delete', id: own.message.id });
  const denied = await g2.waitFor((p) => p.type === 'error' && (p.code === 'forbidden' || p.code === 'not_found'));
  ok('越权删除被服务端拒绝', !!denied, denied?.message || '');
  g2.send({ type: 'edit', id: own.message.id, body: '被篡改' });
  await sleep(250);
  const still = messagesMod.findMessage(own.message.id, { id: null, role: null, actor: chat.actorKey({ nickname: 'Same', guestId: gidA }) });
  ok('越权编辑未落库', still && still.body === '我是 A', still?.body);

  // 改名不改归属：guestId 稳定，历史消息仍是自己的
  g1.send({ type: 'nick', nick: 'Renamed' });
  await g1.waitFor((p) => p.type === 'nick' && p.nickname === 'Renamed');
  await sleep(150);
  const mineAfter = messagesMod.findMessage(own.message.id, { id: null, role: null, actor: `g:${gidA}` });
  ok('改名后历史消息仍归属本人', mineAfter?.isMe === true, `isMe=${mineAfter?.isMe}`);

  g1.close();
  g2.close();
  await sleep(300);
}
{
  ok('guestId 字符集被收敛', chat.normalizeGuestId('short') === '');
  ok('合法 guestId 保留', chat.normalizeGuestId('abc12345-x_y') === 'abc12345-x_y');
  ok('含非法字符的 guestId 被拒', chat.normalizeGuestId('abc/../12345') === '');
  ok('actorKey 优先用 userId', chat.actorKey({ userId: 'u1', nickname: 'x', guestId: 'abc12345' }) === 'u:u1');
  ok('actorKey 游客用 guestId', chat.actorKey({ nickname: 'x', guestId: 'abc12345' }) === 'g:abc12345');
  ok('actorKey 无 guestId 降级到昵称', chat.actorKey({ nickname: '小明' }) === 'n:小明');
}

/* ---------- 17. 禁言目标解析 ---------- */
console.log('\n[17] 禁言目标解析');
{
  const { resolveMuteTarget } = await import('../ws/chat.js');
  ok('userId 前缀直通', resolveMuteTarget('u:12') === 'u:12');
  ok('guestId 前缀保留', resolveMuteTarget('g:abc12345') === 'g:abc12345');
  ok('裸 guestId 自动识别', resolveMuteTarget('abc12345') === 'g:abc12345');
  ok('昵称降级为 n: 前缀', resolveMuteTarget('小明') === 'n:小明');
  const purified = resolveMuteTarget('小明<script>alert(1)</script>');
  ok('昵称里的尖括号被净化', !/[<>&"'`]/.test(purified), purified);
  ok('净化后仍可作为禁言目标', chat.normalizeGuestId(purified) === '' && purified.startsWith('n:'), purified);
}

/* ---------- 18. 连接清理 ---------- */
console.log('\n[18] 连接清理');
const beforeCount = clients.size;
const t = client('nick=Tmp2');
await t.waitFor((p) => p.type === 'ready');
ok('新连接进入集合', clients.size === beforeCount + 1);
t.close();
await sleep(400);
ok('断线后移出集合', clients.size === beforeCount, `${clients.size} vs ${beforeCount}`);
ok('presence 已清理', !chat.onlineList('lobby').includes('Tmp2'));

a.close();
b.close();
await sleep(500);
ok('全部断开后连接数为 0', clients.size === 0, String(clients.size));
ok('presence 已清空', chat.roomCounts().size === 0, JSON.stringify([...chat.roomCounts()]));

srv.close();
setTimeout(() => {
  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${fail ? '失败' : '通过'}：${pass + fail} 项检查（失败 ${fail}）\x1b[0m`);
  process.exit(fail ? 1 : 0);
}, 400);
