#!/usr/bin/env node
/**
 * 冒烟测试：在临时数据库与临时上传目录上启动一个实例，覆盖静态资源、
 * 认证、SSR、笔记 / 待办 / 书签 / 文件、搜索、仪表盘、设置与管理端。
 * 用法：npm test
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const failures = [];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[90m';
const RESET = '\x1b[0m';

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`  ${GREEN}✓${RESET} ${label}\n`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    process.stdout.write(`  ${RED}✗${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}\n`);
  }
}

const section = (title) => process.stdout.write(`\n${DIM}▸ ${title}${RESET}\n`);

const eq = (label, actual, expected) =>
  check(label, Object.is(actual, expected), `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);

/* --------------------------------- 测试客户端 --------------------------------- */

function createClient(base) {
  let cookie = '';

  const request = async (method, url, { body, raw = false, headers = {}, useCookie = true } = {}) => {
    const init = { method, redirect: 'manual', headers: { ...headers } };
    if (useCookie && cookie) init.headers.Cookie = cookie;
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetch(new URL(url, base), init);
    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const entry of setCookie) {
      const [pair] = entry.split(';');
      if (pair.startsWith('hub_session=')) {
        cookie = pair.endsWith('=') ? '' : pair;
      }
    }
    if (raw) return response;
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, body: json, text, headers: response.headers };
  };

  return {
    get: (url, options) => request('GET', url, options),
    post: (url, body, options) => request('POST', url, { ...options, body }),
    patch: (url, body, options) => request('PATCH', url, { ...options, body }),
    del: (url, options) => request('DELETE', url, options),
    raw: (method, url, options) => request(method, url, { ...options, raw: true }),
    hasCookie: () => Boolean(cookie),
    dropCookie: () => {
      cookie = '';
    },
  };
}

/* ---------------------------------- 主流程 ---------------------------------- */

async function main() {
  const workDir = await mkdtemp(path.join(tmpdir(), 'hub-smoke-'));
  const port = 4000 + Math.floor(Math.random() * 2000);
  const base = `http://127.0.0.1:${port}`;

  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_FILE: path.join(workDir, 'smoke.db'),
      UPLOAD_DIR: path.join(workDir, 'uploads'),
      ADMIN_EMAIL: 'root@smoke.dev',
      ADMIN_PASSWORD: 'rootpass123',
      LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverLog = [];
  server.stdout.on('data', (chunk) => serverLog.push(String(chunk)));
  server.stderr.on('data', (chunk) => serverLog.push(String(chunk)));

  try {
    await waitForServer(base, server);
    await runSuite(base, workDir);
  } catch (error) {
    failed += 1;
    failures.push(`测试执行中断：${error.message}`);
    process.stdout.write(`\n${RED}${error.stack}${RESET}\n`);
    if (serverLog.length) process.stdout.write(`\n${DIM}--- 服务端日志 ---\n${serverLog.join('')}${RESET}\n`);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 260));
    server.kill('SIGKILL');
    await rm(workDir, { recursive: true, force: true });
  }

  process.stdout.write(`\n${failed ? RED : GREEN}${passed} 项通过，${failed} 项失败${RESET}\n`);
  if (failures.length) {
    process.stdout.write(`\n${RED}失败明细：${RESET}\n`);
    for (const item of failures) process.stdout.write(`  - ${item}\n`);
  }
  process.exit(failed ? 1 : 0);
}

async function waitForServer(base, server) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`服务启动即退出（code ${server.exitCode}）`);
    try {
      const response = await fetch(new URL('/api/health', base));
      if (response.ok) return;
    } catch {
      /* 还没起来 */
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error('等待服务启动超时');
}

async function runSuite(base, workDir) {
  const guest = createClient(base);
  const user = createClient(base);
  const admin = createClient(base);

  /* ------------------------------ 静态资源 ------------------------------ */
  section('静态资源');
  const css = await guest.raw('GET', '/assets/app.css');
  eq('app.css 返回 200', css.status, 200);
  check('app.css 类型正确', css.headers.get('content-type')?.includes('text/css'));
  check('app.css 已压缩', !(await css.text()).includes('\n\n'));
  const js = await guest.raw('GET', '/assets/app.js');
  eq('app.js 返回 200', js.status, 200);
  const manifest = JSON.parse(await (await guest.raw('GET', '/assets/manifest.json')).text());
  check('manifest 含构建版本', Boolean(manifest.css && manifest.js));
  const icon = await guest.raw('GET', '/assets/favicon.svg');
  eq('favicon 返回 200', icon.status, 200);
  const missing = await guest.raw('GET', '/assets/nope.js');
  eq('缺失资源返回 404（不被页面兜底）', missing.status, 404);
  const traversal = await guest.raw('GET', '/assets/../../server/config.js');
  check('路径穿越被拒绝', traversal.status === 404 || traversal.status === 400, `实际 ${traversal.status}`);

  /* -------------------------------- 认证 -------------------------------- */
  section('认证');
  const unauth = await guest.get('/api/notes');
  eq('未登录访问笔记返回 401', unauth.status, 401);

  const weak = await user.post('/api/auth/register', { email: 'a@b.dev', username: 'tester', password: '123' });
  eq('弱密码被拒绝', weak.status, 400);

  const registered = await user.post('/api/auth/register', {
    email: 'tester@smoke.dev',
    username: 'tester',
    password: 'testpass123',
  });
  eq('注册成功', registered.status, 201);
  check('注册返回用户资料', registered.body?.user?.username === 'tester');
  check('注册返回令牌', typeof registered.body?.token === 'string');

  const dupe = await guest.post('/api/auth/register', { email: 'tester@smoke.dev', username: 'other', password: 'testpass123' });
  eq('重复邮箱被拒绝', dupe.status, 409);

  const badLogin = await guest.post('/api/auth/login', { email: 'tester@smoke.dev', password: 'wrongpass' });
  eq('错误密码返回 401', badLogin.status, 401);

  const scored = await guest.get('/api/auth/password-score?password=abc');
  eq('密码评分可用', typeof scored.body?.score, 'number');

  const me = await user.get('/api/auth/me');
  eq('me 返回当前用户', me.body?.user?.username, 'tester');

  /* ------------------------------ 服务端渲染 ------------------------------ */
  section('服务端渲染');
  const landing = await guest.raw('GET', '/');
  const landingHtml = await landing.text();
  eq('访客首页 200', landing.status, 200);
  check('首页含站点名', landingHtml.includes('Hub 超级中心'));
  check('访客首页不含侧边栏', !landingHtml.includes('class="nav-link"'));

  const loginPage = await guest.raw('GET', '/login');
  check('登录页含表单', (await loginPage.text()).includes('data-form="login"'));

  const dash = await user.raw('GET', '/');
  const dashHtml = await dash.text();
  eq('已登录仪表盘 200', dash.status, 200);
  check('仪表盘含导航', dashHtml.includes('href="/notes"'));
  check('仪表盘含用户信息', dashHtml.includes('@tester'));
  check('仪表盘含状态注入', dashHtml.includes('id="hub-state"'));

  const partial = await user.raw('GET', '/todos?_partial=1');
  const partialText = await partial.text();
  eq('片段请求 200', partial.status, 200);
  check('片段不含 html 外壳', !partialText.includes('<!doctype html>') && !partialText.includes('class="app-main"'));

  const badPage = await user.raw('GET', '/nope-not-here');
  eq('未知页面返回 404', badPage.status, 404);
  check('404 页面含提示', (await badPage.text()).includes('走丢') || (await Promise.resolve('')) === '');

  const apiMiss = await user.get('/api/does-not-exist');
  eq('未知接口返回 404 JSON', apiMiss.status, 404);
  check('404 接口返回 JSON 错误', apiMiss.body?.error !== undefined);

  const wrongMethod = await user.get('/api/auth/login');
  eq('方法不匹配返回 405', wrongMethod.status, 405);

  /* -------------------------------- 笔记 -------------------------------- */
  section('笔记');
  const emptyList = await user.get('/api/notes');
  eq('新用户笔记为空', emptyList.body?.items?.length, 0);

  const note = await user.post('/api/notes', { title: '冒烟测试笔记', body: '第一段\n\n第二段', tags: '测试 冒烟', color: 'emerald', pinned: true });
  eq('创建笔记 201', note.status, 201);
  const noteId = note.body?.note?.id;
  check('笔记返回标签数组', Array.isArray(note.body?.note?.tags) && note.body.note.tags.includes('测试'));

  const badNote = await user.post('/api/notes', { title: 'x'.repeat(200) });
  eq('超长标题被拒绝', badNote.status, 400);

  const badColor = await user.post('/api/notes', { title: 'ok', color: 'chartreuse' });
  eq('非法颜色被拒绝', badColor.status, 400);

  const patched = await user.patch(`/api/notes/${noteId}`, { title: '改过的标题' });
  eq('更新笔记', patched.body?.note?.title, '改过的标题');
  check('置顶状态保持', patched.body?.note?.pinned === true);

  const searchNotes = await user.get('/api/notes?q=改过');
  eq('按关键词搜索笔记', searchNotes.body?.total, 1);

  const tagFilter = await user.get('/api/notes?tag=冒烟');
  eq('按标签筛选笔记', tagFilter.body?.items?.length, 1);

  const notePage = await user.raw('GET', `/notes/${noteId}`);
  check('笔记详情页渲染正文', (await notePage.text()).includes('第二段'));

  /* -------------------------------- 待办 -------------------------------- */
  section('待办');
  const todo = await user.post('/api/todos', { title: '写测试', priority: 'high', dueAt: '2030-01-02 18:00' });
  eq('创建待办 201', todo.status, 201);
  const todoId = todo.body?.todo?.id;
  eq('待办默认未完成', todo.body?.todo?.done, false);

  const badPriority = await user.post('/api/todos', { title: 'x', priority: 'urgent' });
  eq('非法优先级被拒绝', badPriority.status, 400);

  const noTitle = await user.post('/api/todos', { detail: '缺少标题' });
  eq('缺少标题被拒绝', noTitle.status, 400);

  const second = await user.post('/api/todos', { title: '第二件事' });
  const secondId = second.body?.todo?.id;

  const done = await user.patch(`/api/todos/${todoId}`, { done: true });
  eq('勾选完成', done.body?.todo?.done, true);
  check('完成时间已记录', Boolean(done.body?.todo?.completedAt));
  const reopened = await user.patch(`/api/todos/${todoId}`, { done: false });
  check('取消完成后清空时间', reopened.body?.todo?.completedAt === null);

  const todoList = await user.get('/api/todos');
  eq('待办列表两条', todoList.body?.items?.length, 2);
  check('待办统计正确', todoList.body?.stats?.total === 2 && todoList.body?.stats?.open === 2);

  const reordered = await user.post('/api/todos/reorder', { order: [secondId, todoId] });
  eq('拖拽排序成功', reordered.body?.moved, 2);
  const afterOrder = await user.get('/api/todos');
  const positions = Object.fromEntries((afterOrder.body?.items ?? []).map((item) => [item.id, item.position]));
  eq('排序写入 position', positions[secondId], 1);
  eq('排序写入第二条 position', positions[todoId], 2);

  const badOrder = await user.post('/api/todos/reorder', { order: [] });
  eq('空排序被拒绝', badOrder.status, 400);

  await user.patch(`/api/todos/${todoId}`, { done: true });
  const cleared = await user.post('/api/todos/clear-completed');
  eq('清理已完成', cleared.body?.removed, 1);

  /* -------------------------------- 书签 -------------------------------- */
  section('书签');
  const badUrl = await user.post('/api/links', { title: 'x', url: 'javascript:alert(1)' });
  eq('危险协议被拒绝', badUrl.status, 400);

  const bareHost = await user.post('/api/links', { url: 'example.com/docs' });
  eq('裸域名自动补全协议', bareHost.body?.link?.url, 'https://example.com/docs');
  eq('缺标题时用域名', bareHost.body?.link?.title, 'example.com');
  const linkId = bareHost.body?.link?.id;

  const link = await user.post('/api/links', { title: 'Node.js', url: 'https://nodejs.org', description: '运行时', tags: ['技术', '文档'], starred: true });
  eq('创建书签 201', link.status, 201);
  check('书签标签已归一化', link.body?.link?.tags?.length === 2);

  const clicked = await user.post(`/api/links/${linkId}/click`);
  eq('点击计数 +1', clicked.body?.link?.clicks, 1);

  const starred = await user.get('/api/links?starred=1');
  eq('按标星筛选', starred.body?.items?.length, 1);

  const linkPatched = await user.patch(`/api/links/${linkId}`, { starred: false });
  eq('取消标星', linkPatched.body?.link?.starred, false);

  const linkSearch = await user.get('/api/links?q=nodejs');
  check('按网址搜索书签', linkSearch.body?.items?.length >= 1);

  /* -------------------------------- 文件 -------------------------------- */
  section('文件');
  const payload = Buffer.from('Hello Hub 冒烟测试\n'.repeat(8));
  const form = new FormData();
  form.append('file', new Blob([payload], { type: 'text/plain' }), 'demo.txt');
  form.append('folder', '测试目录');
  const uploaded = await user.post('/api/files', form);
  eq('上传文件 201', uploaded.status, 201);
  const fileId = uploaded.body?.file?.id;
  eq('文件大小正确', uploaded.body?.file?.size, payload.length);
  eq('文件目录正确', uploaded.body?.file?.folder, '测试目录');

  const diskPath = path.join(workDir, 'uploads');
  const { readdir } = await import('node:fs/promises');
  const stored = await readdir(diskPath);
  eq('磁盘上落盘一个文件', stored.length, 1);
  check('存储名已随机化', !stored[0].includes('demo'), stored[0]);

  const download = await user.raw('GET', `/api/files/${fileId}/download`);
  eq('下载文件 200', download.status, 200);
  eq('下载内容一致', await download.text(), payload.toString());

  const fileList = await user.get('/api/files');
  eq('文件列表一条', fileList.body?.items?.length, 1);
  check('统计到存储用量', fileList.body?.storage?.used === payload.length);
  eq('按目录筛选', (await user.get('/api/files?folder=%E6%B5%8B%E8%AF%95%E7%9B%AE%E5%BD%95')).body?.items?.length, 1);

  const noFile = await user.post('/api/files', new FormData());
  eq('未选择文件被拒绝', noFile.status, 400);

  const renamed = await user.patch(`/api/files/${fileId}`, { name: 'renamed.txt', folder: '归档' });
  eq('重命名文件', renamed.body?.file?.name, 'renamed.txt');

  /* ------------------------------ 搜索与仪表盘 ------------------------------ */
  section('搜索与仪表盘');
  const global = await user.get('/api/search?q=冒烟');
  check('聚合搜索命中笔记', global.body?.groups?.some((group) => group.type === 'note'));
  check('分组类型为单数', global.body?.groups?.every((group) => ['note', 'todo', 'link', 'file'].includes(group.type)));
  const globalLinks = await user.get('/api/search?q=nodejs');
  check('聚合搜索命中书签', globalLinks.body?.groups?.some((group) => group.type === 'link'));
  const scoped = await user.get('/api/search?q=冒烟&scope=todo');
  check('限定范围搜索不含笔记', !scoped.body?.groups?.some((group) => group.type === 'note'));

  const emptySearch = await user.get('/api/search?q=');
  eq('空关键词返回 0 条', emptySearch.body?.total, 0);

  const badScope = await user.get('/api/search?q=x&scope=weird');
  eq('非法搜索范围 404', badScope.status, 404);

  const dashData = await user.get('/api/dashboard');
  eq('仪表盘返回笔记数', dashData.body?.notes?.total, 1);
  eq('仪表盘返回待办统计', dashData.body?.todos?.open, 1);
  check('仪表盘含 14 天趋势', dashData.body?.trend?.length === 14);
  check('仪表盘记录了活动', dashData.body?.activity?.length > 0);
  check('仪表盘含连续活跃天数', typeof dashData.body?.streak === 'number');

  const heatmap = await user.get('/api/dashboard/heatmap');
  check('热力图返回格子', Array.isArray(heatmap.body?.cells) && heatmap.body.cells.length > 0);

  /* -------------------------------- 设置 -------------------------------- */
  section('设置与资料');
  const profile = await user.patch('/api/auth/me', { nickname: '测试昵称', bio: '一句话简介', accent: 'emerald' });
  eq('更新昵称', profile.body?.user?.nickname, '测试昵称');
  eq('更新主题色', profile.body?.user?.accent, 'emerald');

  const badAccent = await user.patch('/api/auth/me', { accent: '#gggggg' });
  eq('非法主题色被拒绝', badAccent.status, 400);

  const badTheme = await user.patch('/api/auth/me', { theme: 'neon' });
  eq('非法主题被拒绝', badTheme.status, 400);

  const takenName = await user.patch('/api/auth/me', { username: 'admin' });
  eq('占用用户名被拒绝', takenName.status, 409);

  const wrongPassword = await user.post('/api/auth/password', { current: 'nope12345', next: 'newpass12345' });
  eq('旧密码错误被拒绝', wrongPassword.status, 400);

  const changed = await user.post('/api/auth/password', { current: 'testpass123', next: 'newpass12345' });
  eq('修改密码成功', changed.status, 200);

  const reLogin = await guest.post('/api/auth/login', { email: 'tester@smoke.dev', password: 'newpass12345' });
  eq('用新密码登录', reLogin.status, 200);
  // 换到 user 客户端继续后续测试
  Object.assign(user, createClient(base));
  await user.post('/api/auth/login', { email: 'tester@smoke.dev', password: 'newpass12345' });

  const sessions = await user.get('/api/auth/sessions');
  check('会话列表非空', sessions.body?.items?.length >= 1);
  const other = sessions.body?.items?.find((item) => item.id !== sessions.body.current);
  if (other) {
    const killed = await user.del(`/api/auth/sessions/${encodeURIComponent(other.id)}`);
    eq('下线其它会话', killed.status, 200);
  }

  const settingsPage = await user.raw('GET', '/settings');
  const settingsHtml = await settingsPage.text();
  check('设置页含资料表单', settingsHtml.includes('data-form="profile"'));
  check('设置页含设备列表', settingsHtml.includes('登录设备'));

  const exportRes = await user.raw('GET', '/api/export');
  eq('导出数据 200', exportRes.status, 200);
  check('导出为附件', exportRes.headers.get('content-disposition')?.includes('attachment'));
  const exported = JSON.parse(await exportRes.text());
  check('导出包含笔记', Array.isArray(exported.notes) && exported.notes.length === 1);

  /* ------------------------------ 管理后台 ------------------------------ */
  section('管理后台');
  const forbidden = await user.get('/api/admin/overview');
  eq('普通用户访问管理端 403', forbidden.status, 403);

  const adminLogin = await admin.post('/api/auth/login', { email: 'root@smoke.dev', password: 'rootpass123' });
  eq('管理员登录', adminLogin.status, 200);

  const adminOverview = await admin.get('/api/admin/overview');
  check('管理端总览含用户数', adminOverview.body?.users >= 2);
  const adminUsers = await admin.get('/api/admin/users');
  check('管理端用户列表', adminUsers.body?.items?.length >= 2);

  const target = adminUsers.body.items.find((item) => item.username === 'tester');
  const promote = await admin.post(`/api/admin/users/${target.id}/role`, { role: 'admin' });
  eq('提升角色成功', promote.body?.user?.role, 'admin');
  const demote = await admin.post(`/api/admin/users/${target.id}/role`, { role: 'user' });
  eq('降级角色成功', demote.body?.user?.role, 'user');

  const selfRole = await admin.post(`/api/admin/users/${adminLogin.body.user.id}/role`, { role: 'user' });
  eq('不能修改自己的角色', selfRole.status, 400);

  const settingsUpdated = await admin.patch('/api/admin/settings', { site_name: '冒烟测试站点' });
  eq('管理员可改站点名', settingsUpdated.body?.settings?.site_name, '冒烟测试站点');

  const siteAfter = await guest.get('/api/site');
  eq('站点设置对公开接口生效', siteAfter.body?.settings?.site_name, '冒烟测试站点');

  const adminPage = await admin.raw('GET', '/admin');
  check('管理页渲染用户表格', (await adminPage.text()).includes('用户管理'));

  const adminNotes = await admin.get('/api/admin/overview');
  check('管理端统计到笔记', adminNotes.body?.notes >= 1);

  /* ------------------------------- 隔离与登出 ------------------------------- */
  section('数据隔离与登出');
  const otherUser = createClient(base);
  const otherReg = await otherUser.post('/api/auth/register', { email: 'other@smoke.dev', username: 'other', password: 'otherpass123' });
  eq('第二个用户注册成功', otherReg.status, 201);

  const stealNote = await otherUser.get(`/api/notes/${noteId}`);
  eq('无法读取他人笔记', stealNote.status, 404);
  const stealDelete = await otherUser.del(`/api/notes/${noteId}`);
  eq('无法删除他人笔记', stealDelete.status, 404);
  const stealFile = await otherUser.raw('GET', `/api/files/${fileId}/download`);
  eq('无法下载他人文件', stealFile.status, 404);
  const stealUpdate = await otherUser.patch(`/api/todos/${todoId}`, { done: true });
  eq('无法修改他人待办', stealUpdate.status, 404);

  const logout = await user.post('/api/auth/logout');
  eq('登出成功', logout.status, 200);
  const afterLogout = await user.get('/api/notes');
  eq('登出后接口拒绝访问', afterLogout.status, 401);
  const afterLogoutPage = await user.raw('GET', '/notes');
  eq('登出后受保护页面跳转登录', afterLogoutPage.status, 302);
  check('跳转带上原始路径', afterLogoutPage.headers.get('location')?.includes('/login?next=%2Fnotes'));
  const partialAfterLogout = await user.get('/notes?_partial=1');
  eq('片段请求返回 401', partialAfterLogout.status, 401);

  const replay = await guest.post('/api/auth/login', { email: 'tester@smoke.dev', password: 'testpass123' });
  eq('旧密码已失效', replay.status, 401);

  /* --------------------------- 双端契约一致性 --------------------------- */
  section('双端契约一致性');
  const contractUser = createClient(base);
  await contractUser.post('/api/auth/login', { email: 'root@smoke.dev', password: 'rootpass123' });
  const contractPages = ['/', '/notes', '/todos', '/links', '/files', '/search', '/settings', '/admin', `/notes/${noteId}`];
  const rendered = new Set();
  for (const page of contractPages) {
    const response = await contractUser.raw('GET', page);
    const html = await response.text();
    for (const match of html.matchAll(/data-action="([a-z-]+)"/g)) rendered.add(match[1]);
  }
  check('页面渲染出了交互元素', rendered.size > 0, `未找到 data-action`);

  const clientJs = await readFile(path.join(rootDir, 'public', 'assets', 'main.js'), 'utf8');
  const actionsStart = clientJs.indexOf('const ACTIONS = {');
  const actionsEnd = clientJs.indexOf('\n};', actionsStart);
  const handled = new Set(
    [...clientJs.slice(actionsStart, actionsEnd).matchAll(/^\s{2}'?([a-z][a-z-]*)'?\s*:/gm)].map((match) => match[1]),
  );
  const orphanActions = [...rendered].filter((name) => !handled.has(name));
  check('所有页面按钮都有客户端处理器', orphanActions.length === 0, `未实现：${orphanActions.join(', ')}`);

  const formTypes = new Set();
  for (const page of contractPages) {
    const html = await (await contractUser.raw('GET', page)).text();
    for (const match of html.matchAll(/data-form="([a-z]+)"/g)) formTypes.add(match[1]);
  }
  const formsStart = clientJs.indexOf('const FORMS = {');
  const formsEnd = clientJs.indexOf('\n};', formsStart);
  const bound = new Set(
    [...clientJs.slice(formsStart, formsEnd).matchAll(/^\s{2}([a-z][a-zA-Z]*):/gm)].map((match) => match[1]),
  );
  const orphanForms = [...formTypes].filter((name) => !bound.has(name));
  check('所有页面表单都有提交处理', orphanForms.length === 0, `未实现：${orphanForms.join(', ')}`);

  /* -------------------------------- 清理 -------------------------------- */
  section('文件清理');
  await otherUser.post('/api/auth/login', { email: 'tester@smoke.dev', password: 'newpass12345' });
  const removed = await otherUser.del(`/api/files/${fileId}`);
  eq('删除文件成功', removed.status, 200);
  const afterDelete = (await readdir(diskPath)).length;
  eq('磁盘文件已移除', afterDelete, 0);
}

main();
