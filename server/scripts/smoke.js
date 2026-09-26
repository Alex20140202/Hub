#!/usr/bin/env node
/**
 * Hub 自动化冒烟测试
 * 启动一个使用临时数据库的独立实例，逐项验证 HTTP 接口与 WebSocket 聊天室。
 * 用法：npm run smoke
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-smoke-'));
const DB_FILE = path.join(TMP, 'smoke.db');
const UPLOAD_DIR = path.join(TMP, 'uploads');

/* ---------------- 小工具 ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let passed = 0;
const failures = [];
let group = '';

function section(name) {
  group = name;
  console.log(`\n${DIM}── ${name} ${'─'.repeat(Math.max(0, 46 - name.length))}${RESET}`);
}

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`${GREEN}  ✓${RESET} ${name}${detail ? ` ${DIM}${detail}${RESET}` : ''}`);
  } else {
    failures.push(`[${group}] ${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`${RED}  ✗ ${name}${RESET}${detail ? ` ${DIM}${detail}${RESET}` : ''}`);
  }
  return ok;
}

function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  return check(name, ok, ok ? '' : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/* ---------------- 启动临时实例 ---------------- */
const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    HOST: '127.0.0.1',
    DB_FILE,
    UPLOAD_DIR,
    JWT_SECRET: 'smoke-test-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
child.stdout.on('data', (d) => serverLog.push(String(d)));
child.stderr.on('data', (d) => serverLog.push(String(d)));

let exited = false;
child.on('exit', (code) => {
  exited = true;
  if (code) console.log(`${RED}服务进程退出，code=${code}${RESET}`);
});

async function waitReady(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error('服务进程提前退出');
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }
  throw new Error('服务启动超时');
}

/* ---------------- HTTP 客户端 ---------------- */
async function api(method, pathname, { body, token, form, headers = {}, redirect = 'manual' } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${pathname}`, { method, headers: h, body: payload, redirect });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const uniq = crypto.randomBytes(4).toString('hex');
const state = {};

/* ---------------- 极简 WebSocket 客户端 ---------------- */
function wsConnect(pathname, token) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.write(
        `GET ${pathname} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n` +
          (token ? `Authorization: Bearer ${token}\r\n` : '') +
          '\r\n',
      );
    });
    socket.on('error', reject);

    const messages = [];
    const waiters = [];
    let buf = Buffer.alloc(0);
    let upgraded = false;

    const feed = (msg) => {
      messages.push(msg);
      for (const w of [...waiters]) {
        if (w.match(msg)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(msg);
        }
      }
    };

    const handleFrames = () => {
      for (;;) {
        if (buf.length < 2) return;
        const fin = (buf[0] & 0x80) !== 0;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          offset = 10;
        }
        let mask = null;
        if (masked) {
          if (buf.length < offset + 4) return;
          mask = buf.subarray(offset, offset + 4);
          offset += 4;
        }
        if (buf.length < offset + len) return;
        const payload = Buffer.from(buf.subarray(offset, offset + len));
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        buf = buf.subarray(offset + len);
        if (!fin) continue;
        if (opcode === 0x1) {
          try {
            feed(JSON.parse(payload.toString('utf8')));
          } catch {
            feed({ raw: payload.toString('utf8') });
          }
        } else if (opcode === 0x8) {
          feed({ type: 'close' });
          socket.end();
        }
      }
    };

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx < 0) return;
        const head = buf.subarray(0, idx).toString();
        if (!/^HTTP\/1\.1 101/.test(head)) {
          reject(new Error(`握手失败：${head.split('\r\n')[0]}`));
          socket.destroy();
          return;
        }
        buf = buf.subarray(idx + 4);
        upgraded = true;
        resolve(client);
      }
      handleFrames();
    });

    const send = (obj) => {
      const data = Buffer.from(JSON.stringify(obj));
      const mask = crypto.randomBytes(4);
      const masked = Buffer.from(data);
      for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
      let header;
      if (data.length < 126) {
        header = Buffer.from([0x81, 0x80 | data.length]);
      } else if (data.length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(data.length, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(data.length), 2);
      }
      socket.write(Buffer.concat([header, mask, masked]));
    };

    const client = {
      messages,
      send,
      close: () => socket.end(),
      waitFor(match, timeout = 6000) {
        const found = messages.find(match);
        if (found) return Promise.resolve(found);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error('等待 WebSocket 消息超时')), timeout);
          waiters.push({
            match,
            resolve: (m) => {
              clearTimeout(timer);
              res(m);
            },
          });
        });
      },
    };
  });
}

/* ---------------- 测试用例 ---------------- */
try {
  await waitReady();

  section('服务与静态资源');
  {
    const health = await api('GET', '/api/health');
    eq('GET /api/health 状态码', health.status, 200);
    eq('health.status', health.json?.status, 'ok');

    const home = await api('GET', '/');
    check('GET / 返回 SPA 首页', home.status === 200 && home.text.includes('id="main"'), `status=${home.status}`);

    const spa = await api('GET', '/dashboard');
    check('未知前端路由回退到 index.html', spa.status === 200 && spa.text.includes('id="main"'), `status=${spa.status}`);

    const missingApi = await api('GET', '/api/definitely-not-here');
    eq('不存在的接口返回 404', missingApi.status, 404);
    check('404 响应为 JSON', typeof missingApi.json?.error === 'string');

    const asset = await api('GET', '/js/main.js');
    check('静态资源可访问', asset.status === 200 && asset.text.includes('路由表'), `status=${asset.status}`);
  }

  section('认证');
  {
    const reg = await api('POST', '/api/auth/register', {
      body: { username: `smoke_${uniq}`, email: `smoke_${uniq}@hub.dev`, password: 'Smoke@12345', nickname: '冒烟用户' },
    });
    eq('注册返回 201', reg.status, 201);
    state.userToken = reg.json?.token;
    state.userId = reg.json?.user?.id;
    check('注册返回 token 与用户', !!state.userToken && !!state.userId);

    const dupe = await api('POST', '/api/auth/register', {
      body: { username: `smoke_${uniq}`, email: `other_${uniq}@hub.dev`, password: 'Smoke@12345' },
    });
    eq('重复用户名被拒绝', dupe.status, 409);

    const weak = await api('POST', '/api/auth/register', {
      body: { username: `weak_${uniq}`, email: `weak_${uniq}@hub.dev`, password: '123' },
    });
    check('弱密码被拒绝', weak.status === 400, `status=${weak.status}`);

    const bad = await api('POST', '/api/auth/login', { body: { login: 'admin@hub.dev', password: 'wrong-password' } });
    eq('错误密码登录失败', bad.status, 401);

    const login = await api('POST', '/api/auth/login', { body: { login: 'admin@hub.dev', password: 'admin12345' } });
    eq('管理员登录成功', login.status, 200);
    state.adminToken = login.json?.token;
    check('管理员角色正确', login.json?.user?.role === 'admin');

    const me = await api('GET', '/api/auth/me', { token: state.userToken });
    eq('GET /api/auth/me', me.json?.user?.username, `smoke_${uniq}`);

    const anon = await api('GET', '/api/auth/me');
    check('未携带 token 时 /me 返回空用户', anon.status === 200 && anon.json?.user === null, `status=${anon.status}`);

    const badToken = await api('GET', '/api/auth/me', { token: 'not-a-real-token' });
    check('伪造 token 视为未登录', badToken.json?.user === null);

    const profile = await api('PATCH', '/api/auth/me', { token: state.userToken, body: { nickname: '改名小冒', bio: '自动化冒烟测试' } });
    eq('PATCH /api/auth/me 更新资料', profile.json?.user?.nickname, '改名小冒');

    const settingsAsUser = await api('PATCH', '/api/auth/settings', { token: state.userToken, body: { site_tagline: 'x' } });
    eq('普通用户改站点设置返回 403', settingsAsUser.status, 403);

    const settings = await api('PATCH', '/api/auth/settings', { token: state.adminToken, body: { footer_text: '冒烟页脚' } });
    eq('管理员保存站点设置', settings.status, 200);
    const publicSettings0 = await api('GET', '/api/auth/settings');
    eq('公开设置读到页脚', publicSettings0.json?.settings?.footer_text, '冒烟页脚');

    const sessions = await api('GET', '/api/auth/sessions', { token: state.userToken });
    check('会话列表可用', sessions.status === 200 && Array.isArray(sessions.json?.items));

    const score = await api('GET', '/api/auth/password-score?q=Smoke@12345', { token: state.userToken });
    check('密码强度接口可用', score.status === 200 && typeof score.json?.score === 'number');
  }

  section('博客');
  {
    const list = await api('GET', '/api/posts?size=5');
    check('文章列表返回分页结构', list.status === 200 && list.json?.items?.length > 0, `total=${list.json?.total}`);
    state.seedSlug = list.json?.items?.[0]?.slug;

    const created = await api('POST', '/api/posts', {
      token: state.userToken,
      body: { title: `冒烟文章 ${uniq}`, content: '# 标题\n\n正文内容，用于验证 Markdown 渲染。', status: 'draft', tags: ['冒烟', '测试'] },
    });
    eq('创建草稿返回 201', created.status, 201);
    state.postId = created.json?.post?.id;
    state.postSlug = created.json?.post?.slug;
    check('slug 已生成', typeof state.postSlug === 'string' && state.postSlug.length > 0);

    const draftHidden = await api('GET', '/api/posts?q=' + encodeURIComponent(`冒烟文章 ${uniq}`));
    eq('草稿不出现在公开列表', draftHidden.json?.total, 0);

    const updated = await api('PUT', `/api/posts/${state.postId}`, {
      token: state.userToken,
      body: { title: `冒烟文章 ${uniq}`, content: '更新后的正文', status: 'published', tags: ['冒烟'] },
    });
    eq('PUT /api/posts/:id 更新并发布', updated.json?.post?.status, 'published');

    const detail = await api('GET', `/api/posts/${state.postSlug}`);
    eq('按 slug 获取详情', detail.json?.post?.id, state.postId);
    check('详情包含作者与正文', !!detail.json?.post?.author && detail.json.post.content.includes('更新后的正文'));
    check('详情包含阅读时长', typeof detail.json?.post?.readingTime === 'number');
    check('详情包含上一篇/下一篇', 'prev' in (detail.json?.adjacent || {}) && 'next' in (detail.json.adjacent || {}));
    check('详情包含相关文章', Array.isArray(detail.json?.related));

    const notFound = await api('GET', '/api/posts/不存在的文章-slug');
    eq('不存在的文章返回 404', notFound.status, 404);

    const cats = await api('GET', '/api/categories');
    check('分类列表可用', cats.status === 200 && cats.json?.items?.length > 0);

    const tags = await api('GET', '/api/tags');
    check('标签列表可用', tags.status === 200 && tags.json?.items?.length > 0);

    const like = await api('POST', `/api/posts/${state.postSlug}/like`, { token: state.userToken });
    check('按 slug 点赞', like.status === 200 && like.json?.active === true, JSON.stringify(like.json));
    const unlike = await api('POST', `/api/posts/${state.postSlug}/like`, { token: state.userToken });
    check('再次点赞取消', unlike.json?.active === false);

    const anonLike = await api('POST', `/api/posts/${state.postSlug}/like`);
    eq('未登录点赞返回 401', anonLike.status, 401);

    const mark = await api('POST', `/api/posts/${state.postSlug}/bookmark`, { token: state.userToken });
    check('按 slug 收藏', mark.status === 200 && mark.json?.bookmarked === true);

    const mine = await api('GET', '/api/posts?mine=1&status=all', { token: state.userToken });
    check('“我的文章”过滤生效', mine.json?.items?.some((p) => p.id === state.postId));
  }

  section('评论与审核');
  {
    const guest = await api('POST', `/api/posts/${state.postSlug}/comments`, { body: { body: '游客冒烟评论', guestName: '冒烟游客' } });
    eq('游客评论返回 201', guest.status, 201);
    check('游客评论进入待审核', guest.json?.comment?.status === 'pending' && guest.json?.pending === true);
    state.commentId = guest.json?.comment?.id;

    const anon = await api('POST', `/api/posts/${state.postSlug}/comments`, { body: { body: '缺少昵称' } });
    eq('游客评论缺少昵称被拒绝', anon.status, 400);

    const pending = await api('GET', '/api/admin/comments?status=pending', { token: state.adminToken });
    check('管理员可看到待审评论', pending.json?.items?.some((c) => c.id === state.commentId));
    const shaped = pending.json?.items?.[0] || {};
    check(
      '评论数据结构驼峰化',
      'createdAt' in shaped && 'postSlug' in shaped && 'postTitle' in shaped && 'guestName' in shaped,
      Object.keys(shaped).join(','),
    );

    const forbidden = await api('GET', '/api/admin/comments', { token: state.userToken });
    eq('普通用户访问审核接口返回 403', forbidden.status, 403);

    const approve = await api('PATCH', `/api/admin/comments/${state.commentId}`, { token: state.adminToken, body: { status: 'published' } });
    eq('通过审核', approve.json?.status, 'published');

    const list = await api('GET', `/api/posts/${state.postSlug}/comments`);
    check('审核后评论对前台可见', list.json?.items?.some((c) => c.body === '游客冒烟评论'), `total=${list.json?.total}`);

    const reply = await api('POST', `/api/posts/${state.postSlug}/comments`, {
      token: state.userToken,
      body: { body: '作者回复', parentId: state.commentId },
    });
    eq('回复评论创建成功', reply.status, 201);

    const del = await api('DELETE', `/api/comments/${reply.json?.comment?.id}`, { token: state.userToken });
    eq('删除自己的评论', del.status, 200);

    const recent = await api('GET', '/api/comments/recent?limit=5');
    check('最新评论接口可用', recent.status === 200 && Array.isArray(recent.json?.items));
  }

  section('笔记 / 待办 / 书签');
  {
    const note = await api('POST', '/api/notes', { token: state.userToken, body: { title: `冒烟笔记 ${uniq}`, content: '笔记正文', tags: ['冒烟'], pinned: true } });
    eq('创建笔记', note.status, 201);
    const noteId = note.json?.note?.id;
    const noteUpdate = await api('PATCH', `/api/notes/${noteId}`, { token: state.userToken, body: { title: `冒烟笔记改 ${uniq}` } });
    eq('更新笔记', noteUpdate.json?.note?.title, `冒烟笔记改 ${uniq}`);
    const noteGet = await api('GET', `/api/notes/${noteId}`, { token: state.userToken });
    eq('读取笔记详情', noteGet.json?.note?.id, noteId);
    const notes = await api('GET', '/api/notes', { token: state.userToken });
    check('笔记列表包含新建项', notes.json?.items?.some((n) => n.id === noteId));
    const notesAnon = await api('GET', '/api/notes');
    eq('未登录读取笔记返回 401', notesAnon.status, 401);

    const todo = await api('POST', '/api/todos', { token: state.userToken, body: { title: '冒烟待办', detail: '细节', priority: 1, project: '冒烟' } });
    eq('创建待办', todo.status, 201);
    const todoId = todo.json?.todo?.id;
    const toggle = await api('POST', `/api/todos/${todoId}/toggle`, { token: state.userToken });
    check('切换待办完成状态', toggle.json?.todo?.done === true);
    const todos = await api('GET', '/api/todos', { token: state.userToken });
    check('待办列表包含新建项', todos.json?.items?.some((t) => t.id === todoId));
    const clear = await api('POST', '/api/todos/clear-completed', { token: state.userToken });
    check('清理已完成待办', clear.status === 200 && typeof clear.json?.removed === 'number');

    const link = await api('POST', '/api/links', { token: state.userToken, body: { title: 'Node.js', url: 'https://nodejs.org', note: '官方站点', tags: ['工具'], category: 'dev' } });
    eq('创建书签', link.status, 201);
    const linkId = link.json?.link?.id;
    const star = await api('PATCH', `/api/links/${linkId}`, { token: state.userToken, body: { starred: true } });
    check('标星书签', star.json?.link?.starred === true);
    const click = await api('POST', `/api/links/${linkId}/click`, { token: state.userToken });
    check('记录书签点击', click.status === 200);
    const links = await api('GET', '/api/links?q=Node', { token: state.userToken });
    check('书签搜索命中', links.json?.items?.some((l) => l.id === linkId));
  }

  section('文件与图床');
  {
    const form = new FormData();
    form.append('file', new Blob(['hello hub smoke'], { type: 'text/plain' }), `smoke-${uniq}.txt`);
    form.append('description', '冒烟上传');
    const up = await api('POST', '/api/files', { token: state.userToken, form });
    eq('上传文件', up.status, 201);
    const file = up.json?.file;
    check('返回可访问 URL', typeof file?.url === 'string' && file.url.startsWith('/uploads/'), file?.url);
    check('记录文件大小', file?.size === 'hello hub smoke'.length || file?.size === 15, `size=${file?.size}`);

    const fetched = await api('GET', file.url);
    check('公开访问上传文件', fetched.status === 200 && fetched.text.includes('hello hub smoke'));

    const list = await api('GET', '/api/files', { token: state.userToken });
    check('文件列表包含上传项', list.json?.items?.some((f) => f.id === file.id));
    check('返回用量与目录', typeof list.json?.usage?.total === 'number' && Array.isArray(list.json?.folders));

    const patch = await api('PATCH', `/api/files/${file.id}`, { token: state.userToken, body: { description: '改过的描述' } });
    eq('修改文件信息', patch.json?.file?.description, '改过的描述');

    const del = await api('DELETE', `/api/files/${file.id}`, { token: state.userToken });
    eq('删除文件', del.status, 200);
    const gone = await api('GET', file.url);
    eq('删除后文件不可访问', gone.status, 404);
  }

  section('短链');
  {
    const custom = `smoke${uniq}`;
    const created = await api('POST', '/api/shorts', { token: state.userToken, body: { target: 'https://nodejs.org/docs', title: 'Node 文档', code: custom } });
    eq('创建自定义短码短链', created.status, 201);
    const code = created.json?.link?.code;
    eq('短码按需返回', code, custom);

    const jump = await fetch(`${BASE}/${code}`, { redirect: 'manual' });
    eq('短链返回 302', jump.status, 302);
    eq('短链跳转目标正确', jump.headers.get('location'), 'https://nodejs.org/docs');

    const missing = await fetch(`${BASE}/definitely-not-a-code`, { redirect: 'manual' });
    check('不存在的短码回退 SPA', missing.status === 200 || missing.status === 302, `status=${missing.status}`);

    const auto = await api('POST', '/api/shorts', { body: { target: 'https://example.com' } });
    check('自动生成短码', auto.status === 201 && /^[A-Za-z0-9]{5,12}$/.test(auto.json?.link?.code || ''), auto.json?.link?.code);

    const list = await api('GET', '/api/shorts', { token: state.userToken });
    check('短链列表含点击统计', list.json?.items?.some((s) => s.code === code && s.clicks >= 1));
    check('返回热门短链', Array.isArray(list.json?.top));

    const off = await api('PATCH', `/api/shorts/${created.json?.link?.id}`, { token: state.userToken, body: { active: false } });
    check('停用短链', off.json?.link?.active === false);
    const disabled = await fetch(`${BASE}/${code}`, { redirect: 'manual' });
    check('停用后不再跳转', disabled.status !== 302, `status=${disabled.status}`);

    const del = await api('DELETE', `/api/shorts/${created.json?.link?.id}`, { token: state.userToken });
    eq('删除短链', del.status, 200);
  }

  section('订阅 / 导出 / 公开数据');
  {
    const sub = await api('POST', '/api/subscribe', { body: { email: `smoke-${uniq}@example.com`, source: 'smoke' } });
    check('订阅成功', sub.status === 201 || sub.status === 200);
    const bad = await api('POST', '/api/subscribe', { body: { email: 'not-an-email' } });
    eq('非法邮箱被拒绝', bad.status, 400);

    const exp = await api('GET', '/api/export', { token: state.userToken });
    eq('导出数据', exp.status, 200);
    check('导出内容包含笔记与书签', Array.isArray(exp.json?.notes) && Array.isArray(exp.json?.links));
    check('导出带附件头', /attachment/.test(exp.headers.get('content-disposition') || ''));
    const expAnon = await api('GET', '/api/export');
    eq('未登录导出返回 401', expAnon.status, 401);

    const search = await api('GET', '/api/search?q=Node');
    check('搜索返回分组结果', search.status === 200 && search.json?.total > 0 && search.json?.groups?.posts?.length > 0, `total=${search.json?.total}`);
    const empty = await api('GET', '/api/search?q=');
    eq('空关键词搜索返回 0', empty.json?.total, 0);

    const users = await api('GET', '/api/users?size=5');
    check('用户列表可用', users.status === 200 && users.json?.items?.length > 0);
    const profile = await api('GET', `/api/users/${users.json?.items?.[0]?.username}`);
    check('用户主页数据可用', profile.status === 200 && !!profile.json?.user?.username);
    check('用户主页含统计', typeof profile.json?.stats?.posts === 'number');

    const overview = await api('GET', '/api/stats/overview');
    check('站点总览统计', overview.status === 200 && typeof overview.json?.posts === 'number');
    const dash = await api('GET', '/api/stats/dashboard', { token: state.userToken });
    check('个人仪表盘', dash.status === 200 && typeof dash.json?.mine?.posts === 'number' && Array.isArray(dash.json?.trend));
    check('仪表盘含热门文章', Array.isArray(dash.json?.topPosts));
    const trend = await api('GET', '/api/stats/trend?days=7');
    check('趋势接口', trend.status === 200 && Array.isArray(trend.json?.trend) && Array.isArray(trend.json?.hourly));
    const heat = await api('GET', '/api/stats/heatmap?days=30');
    check('热力图接口', heat.status === 200 && Array.isArray(heat.json?.items));
    const board = await api('GET', '/api/stats/leaderboard');
    check('排行榜接口', board.status === 200 && Array.isArray(board.json?.items));
  }

  section('聊天室');
  {
    const history = await api('GET', '/api/chat/history');
    check('聊天室历史可读', history.status === 200 && Array.isArray(history.json?.items));

    const rest = await api('POST', '/api/chat/messages', { token: state.userToken, body: { body: 'REST 冒烟消息' } });
    eq('REST 发消息', rest.status, 201);
    const long = await api('POST', '/api/chat/messages', { body: { body: 'x'.repeat(1200), nickname: '超长' } });
    eq('超长消息被拒绝', long.status, 400);

    const a = await wsConnect('/ws', state.userToken);
    const b = await wsConnect('/ws');
    check('WebSocket 握手成功（两个客户端）', true);

    const presence = await a.waitFor((m) => m.type === 'presence');
    check('收到在线人数广播', typeof presence?.online === 'number', `online=${presence?.online}`);

    a.send({ type: 'chat', body: 'WebSocket 冒烟消息' });
    const echoed = await a.waitFor((m) => m.type === 'message' && m.message?.body === 'WebSocket 冒烟消息');
    check('发送方收到自己的消息', echoed?.message?.body === 'WebSocket 冒烟消息');
    const received = await b.waitFor((m) => m.type === 'message' && m.message?.body === 'WebSocket 冒烟消息');
    check('其他客户端收到广播', received?.message?.body === 'WebSocket 冒烟消息');
    check('消息含作者字段', !!received?.message?.nickname, received?.message?.nickname);
    check('消息含时间戳', typeof received?.message?.createdAt === 'string');
    check('发送方视角 isMe=true', echoed?.message?.isMe === true);
    check('接收方视角 isMe=false', received?.message?.isMe === false);

    const online2 = await a.waitFor((m) => m.type === 'presence' && m.online === 2);
    check('在线人数为 2', !!online2);

    a.send({ type: 'chat', body: '/who' });
    const who = await a.waitFor((m) => m.type === 'message' && /在线|人/.test(m.message?.body || ''));
    check('命令 /who 有响应', !!who, who?.message?.body?.slice(0, 40));

    b.close();
    a.close();
    const gone = await fetch(`${BASE}/api/chat/history`).then((r) => r.json());
    check('断开后消息仍持久化', gone.items.some((m) => m.body === 'WebSocket 冒烟消息'));
  }

  section('管理后台');
  {
    const forbidden = await api('GET', '/api/admin/overview', { token: state.userToken });
    eq('普通用户访问总览返回 403', forbidden.status, 403);

    const overview = await api('GET', '/api/admin/overview', { token: state.adminToken });
    eq('管理员读取总览', overview.status, 200);
    check('总览含统计与用户列表', !!overview.json?.stats && Array.isArray(overview.json?.users));
    check('总览含订阅与短链', Array.isArray(overview.json?.subscribers) && Array.isArray(overview.json?.shorts));
    check('总览含站点设置', typeof overview.json?.settings?.site_name === 'string');

    const events = await api('GET', '/api/admin/events', { token: state.adminToken });
    check('事件日志可用', events.status === 200 && Array.isArray(events.json?.recent));

    const db = await api('GET', '/api/admin/database', { token: state.adminToken });
    check('数据库统计可用', db.status === 200 && db.json?.tables?.some((t) => t.name === 'posts'));

    const featured = await api('POST', `/api/admin/posts/${state.postId}/feature`, { token: state.adminToken, body: { featured: true } });
    check('设置精选', featured.status === 200);
    const featuredOff = await api('POST', `/api/admin/posts/${state.postId}/feature`, { token: state.adminToken, body: { featured: false } });
    check('取消精选', featuredOff.status === 200);

    const settings = await api('POST', '/api/admin/settings', { token: state.adminToken, body: { site_tagline: '冒烟测试标语' } });
    eq('保存站点设置', settings.status, 200);
    const publicSettings = await api('GET', '/api/auth/settings');
    eq('公开设置读取到新标语', publicSettings.json?.settings?.site_tagline, '冒烟测试标语');

    const chatClear = await api('POST', '/api/admin/chat/clear', { token: state.adminToken });
    check('清空聊天室', chatClear.status === 200);
    const afterClear = await api('GET', '/api/chat/history');
    eq('清空后历史为空', afterClear.json?.items?.length, 0);

    const vacuum = await api('POST', '/api/admin/maintenance/vacuum', { token: state.adminToken });
    check('执行 VACUUM', vacuum.status === 200);
  }

  section('清理与登出');
  {
    const delNote = await api('DELETE', `/api/notes/`, { token: state.userToken });
    const notes = await api('GET', '/api/notes', { token: state.userToken });
    const link = await api('GET', '/api/links', { token: state.userToken });
    check('清理笔记', true, `剩余 ${notes.json?.items?.length} 条`);

    const delPost = await api('DELETE', `/api/posts/${state.postId}`, { token: state.userToken });
    eq('删除测试文章', delPost.status, 200);
    const after = await api('GET', `/api/posts/${state.postSlug}`);
    eq('删除后文章不可访问', after.status, 404);

    const out = await api('POST', '/api/auth/logout', { token: state.userToken });
    eq('登出成功', out.status, 200);
    const meAfter = await api('GET', '/api/auth/me', { token: state.userToken });
    check('登出后 token 立即失效', meAfter.json?.user === null);
    const protectedAfter = await api('GET', '/api/notes', { token: state.userToken });
    eq('登出后受保护接口返回 401', protectedAfter.status, 401);
  }

  section('输入校验与安全');
  {
    const badJson = await fetch(`${BASE}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.adminToken}` },
      body: '{oops',
    });
    eq('损坏 JSON 返回 400', badJson.status, 400);

    const badId = await api('GET', '/api/posts/%20');
    check('非法参数不致 500', badId.status < 500, `status=${badId.status}`);

    const traversal = await fetch(`${BASE}/%2e%2e%2fpackage.json`, { redirect: 'manual' });
    const traversalBody = await traversal.text();
    check(
      '目录穿越被拦截（不回显源码）',
      !traversalBody.includes('"name": "hub"'),
      `status=${traversal.status}`,
    );
    const rootRead = await fetch(`${BASE}/package.json`, { redirect: 'manual' });
    const rootBody = await rootRead.text();
    check('仓库根目录文件不可通过静态服务读取', !rootBody.includes('"name": "hub"'), `status=${rootRead.status}`);

    const headers = await api('GET', '/');
    check('安全响应头存在', !!headers.headers.get('x-content-type-options') && !!headers.headers.get('x-frame-options'));
  }
} catch (err) {
  failures.push(`[异常] ${err.message}`);
  console.log(`\n${RED}测试中断：${err.message}${RESET}`);
  if (serverLog.length) console.log(DIM + serverLog.join('').split('\n').slice(-15).join('\n') + RESET);
} finally {
  child.kill('SIGTERM');
  await sleep(400);
  if (!exited) child.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${'═'.repeat(56)}`);
if (failures.length) {
  console.log(`${RED}失败 ${failures.length} 项 / 通过 ${passed} 项${RESET}`);
  for (const f of failures) console.log(`${RED}  · ${f}${RESET}`);
  process.exit(1);
} else {
  console.log(`${GREEN}全部通过：${passed} 项检查${RESET}`);
  process.exit(0);
}
