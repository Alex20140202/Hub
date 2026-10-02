import { get, run, tx } from '../db.js';
import { hashPassword } from '../lib/password.js';
import { config } from '../config.js';
import { createUser, findByEmail } from './users.js';
import { createNote } from './notes.js';
import { createLink } from './links.js';
import { createTodo } from './todos.js';
import { recordEvent } from './stats.js';

const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

function ensureUser(spec, role) {
  const existing = findByEmail(spec.email);
  if (existing) return existing;
  const user = createUser({
    email: spec.email,
    username: spec.username,
    nickname: spec.nickname,
    passwordHash: hashPassword(spec.password),
    role,
  });
  recordEvent(user.id, 'user.register', '注册账号');
  return user;
}

function seedDemoContent(user) {
  if (get('SELECT COUNT(*) AS n FROM notes WHERE user_id = ?', user.id).n > 0) return;

  tx(() => {
    createNote(user.id, {
      title: '欢迎来到 Hub 超级中心',
      body: '这里是你的个人工作台：左侧导航可以在仪表盘、笔记、待办、书签、文件之间切换。\n\n试试这些：\n- 按 ⌘K / Ctrl+K 打开命令面板\n- 在「设置」里切换明暗模式与主题色\n- 拖拽文件到「文件」页即可上传\n- 待办支持优先级、截止日期与拖拽排序',
      tags: '入门 指南',
      color: 'indigo',
      pinned: 1,
    });
    createNote(user.id, {
      title: '本周工作复盘思路',
      body: '1. 收敛：把进行中的事情砍到三条以内\n2. 复盘：每周固定留出 30 分钟回看\n3. 沉淀：把可复用的部分写进笔记，而不是留在脑子里',
      tags: '复盘 方法论',
      color: 'emerald',
    });
    createNote(user.id, {
      title: '零依赖 Node.js 服务备忘',
      body: 'node:http 起服务，node:sqlite 做存储，scrypt 负责密码，createHmac 负责会话签名。整套跑起来不需要 node_modules。',
      tags: '技术 Node.js',
      color: 'cyan',
    });

    const todos = [
      { title: '整理本周待办清单', detail: '把模糊的事项拆成可执行步骤', priority: 'high', dueAt: `${day(0)} 18:00` },
      { title: '给项目写一版 README', detail: '包含快速开始与环境变量说明', priority: 'high', dueAt: `${day(1)} 20:00` },
      { title: '清理浏览器书签', detail: '把收藏夹里过期的条目归档', priority: 'low' },
      { title: '备份数据库文件', detail: '直接复制 data/hub.db 即可', priority: 'normal', dueAt: `${day(3)} 12:00` },
    ];
    for (const todo of todos) createTodo(user.id, todo);
    run('UPDATE todos SET done = 1, completed_at = datetime(\'now\') WHERE user_id = ? AND title = ?', user.id, '清理浏览器书签');

    const links = [
      { title: 'Node.js 官方文档', url: 'https://nodejs.org/docs/latest/api/', description: '运行时与内置模块手册', tags: '技术 文档', starred: 1 },
      { title: 'MDN Web Docs', url: 'https://developer.mozilla.org/zh-CN/', description: '前端 API 查询', tags: '技术 文档' },
      { title: 'Can I use', url: 'https://caniuse.com/', description: '浏览器兼容性速查', tags: '技术 工具', starred: 1 },
      { title: 'Hacker News', url: 'https://news.ycombinator.com/', description: '技术圈资讯', tags: '资讯' },
    ];
    for (const link of links) createLink(user.id, link);
  });
}

/** 首次启动时创建管理员与演示账号，并写入示例内容。 */
export function seed() {
  const admin = ensureUser(
    { email: config.adminEmail, username: 'admin', nickname: '管理员', password: config.adminPassword },
    'admin',
  );
  const demo = ensureUser(
    { email: config.demoEmail, username: 'demo', nickname: '演示用户', password: config.demoPassword },
    'user',
  );
  seedDemoContent(demo);
  return { admin, demo };
}

export const needsSeed = () => !get('SELECT 1 AS ok FROM users LIMIT 1');
