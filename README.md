# Hub

> 一个用 **原生 Node.js** 写成的全栈综合站点：博客、笔记、待办、书签、短链、图床、实时聊天室、数据仪表盘、站内搜索与管理后台，全部跑在**一个进程**里，**零第三方依赖**（`node_modules` 为空）。

- 运行时：`node:http` + `node:sqlite` + 手写 RFC 6455 WebSocket + 自研哈希路由 SPA
- 前端：原生 ES Module、Canvas 图表、手写 Markdown 渲染，无构建步骤
- 代码规模：约 12.5k 行 JS / CSS / HTML

---

## 快速开始

```bash
node -v            # 需要 Node.js >= 22.5（推荐 24/26 LTS）
npm start          # 启动服务，默认 http://localhost:3535
```

首次启动会自动建库、执行迁移并写入种子数据，终端会打印管理员与演示账号。

```bash
npm run dev        # node --watch 热重启
npm run smoke      # 自动化冒烟测试（141 项检查，使用临时数据库，不污染 data/hub.db）
npm run reset      # 清空并重建数据库 + 种子数据
npm run seed       # 仅在数据库为空时写入种子数据
```

### 内置账号

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 管理员 | `admin@hub.dev` | `admin12345` |
| 演示用户 | `demo@hub.dev` | `demo12345` |

> 生产环境请务必通过环境变量覆盖（见下表），并尽快修改默认密码。

---

## 环境变量

全部可选，均有默认值；也可以写在项目根目录的 `.env`（`KEY=VALUE`，`#` 注释）。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3535` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `NODE_ENV` | `development` | `production` 时隐藏错误堆栈、要求 `JWT_SECRET` |
| `JWT_SECRET` | 开发环境按项目路径派生 | **生产环境必须设置**，否则重启后会话失效 |
| `DB_FILE` | `data/hub.db` | SQLite 文件路径（冒烟测试用临时文件） |
| `UPLOAD_DIR` | `public/uploads` | 上传目录 |
| `ADMIN_EMAIL` | `admin@hub.dev` | 种子管理员邮箱 |
| `ADMIN_PASSWORD` | `admin12345` | 种子管理员密码 |
| `MAX_UPLOAD_BYTES` | `10485760` | 单文件上传上限（10 MiB） |

示例：

```bash
NODE_ENV=production JWT_SECRET=$(openssl rand -hex 32) PORT=3535 npm start
```

---

## 功能一览

| 模块 | 路由 | 能力 |
| --- | --- | --- |
| 首页 | `#/` | 站点统计、精选文章、最新评论、热门标签、订阅入口 |
| 博客 | `#/blog` | 列表 / 详情 / 分类 / 标签 / 排序 / 搜索 / 分页、草稿、精选、阅读量、点赞、收藏 |
| 写作 | `#/blog/new`、`#/blog/:slug/edit` | Markdown 编辑器、实时预览、标签与分类、草稿 / 发布 |
| 笔记 | `#/notes` | 速记、置顶、颜色标签、标签筛选、搜索 |
| 待办 | `#/todos` | 优先级、截止日期、项目分组、拖拽排序、完成统计 |
| 书签 | `#/links` | 分类、标签、标星、点击统计、搜索 |
| 文件 | `#/files` | 拖拽上传、目录分类、公开 / 私有、下载统计、用量统计 |
| 短链 | `#/short` | 自定义短码、点击统计、停用、管理后台统一管理 |
| 聊天室 | `#/chat` | WebSocket 实时消息、在线人数、`/help` 指令、消息持久化 |
| 仪表盘 | `#/dashboard` | 个人数据、趋势折线图、热力图、待办 / 收藏 / 文件快捷入口 |
| 个人中心 | `#/profile` | 资料编辑、文章、评论、收藏 |
| 用户主页 | `#/u/:username` | 他人资料、公开文章与统计 |
| 搜索 | `#/search` | 跨文章 / 笔记 / 书签 / 待办 / 用户 / 标签聚合搜索 |
| 设置 | `#/settings` | 资料、密码、外观主题、主题色、会话管理、数据导出 |
| 管理后台 | `#/admin` | 总览图表、内容管理、评论审核、用户、短链、订阅、站点设置、数据库维护 |
| 命令面板 | `⌘K` / `Ctrl+K` | 全站命令与文章 / 用户搜索 |

其它细节：亮色 / 暗色 / 跟随系统主题、响应式布局、键盘可达性（跳转链接、`Esc` 关闭弹层）、Toast 提示、骨架屏、乐观更新。

---

## 目录结构

```
.
├── server/                 # 后端（零依赖）
│   ├── index.js            # 入口：路由装配、静态资源、限流、错误处理、优雅退出
│   ├── config.js           # 配置与 .env 解析
│   ├── db.js               # node:sqlite 封装：迁移、查询helper、事务
│   ├── http/               # 路由器、请求体与 multipart 解析、静态文件、响应封装
│   ├── lib/                # JWT、密码、校验、限流、日志、id / slug、会话
│   ├── models/             # 数据访问层（users/posts/comments/notes/...）
│   ├── routes/             # auth / posts / workspace / misc / public 五组接口
│   ├── services/           # 短链跳转解析
│   ├── ws/                 # WebSocket 帧编解码与聊天室逻辑
│   └── scripts/            # reset.js、smoke.js
├── public/                 # 前端（无构建，直接由浏览器加载 ES Module）
│   ├── index.html
│   ├── css/                # tokens / base / layout / components
│   └── js/
│       ├── main.js         # 启动、路由表、外壳、鉴权守卫
│       ├── lib/            # api、router、store、dom、format、markdown
│       ├── ui/             # modal、toast、components、chart、command、user-menu
│       └── views/          # 20 个页面视图
├── data/hub.db             # SQLite 数据库（自动创建）
└── package.json
```

---

## HTTP 接口

所有接口以 `/api` 为前缀；认证相关挂在 `/api/auth` 下，其余挂在 `/api` 根下。请求与响应均为 JSON（上传为 `multipart/form-data`，导出为文件下载）。除标注外，写操作需要 `Authorization: Bearer <token>`。

<details>
<summary>接口清单（点击展开）</summary>

### 认证 `/api/auth`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/register` | 注册（返回 token） |
| POST | `/login` | 登录（返回 token，同时写入会话） |
| POST | `/logout` | 登出并立即吊销当前 token |
| GET | `/me` | 当前用户与未读评论数（未登录返回 `{user:null}`） |
| PATCH | `/me` | 更新资料 / 密码 / 主题 / 主题色 |
| GET | `/sessions` | 登录设备列表 |
| DELETE | `/sessions/:id` | 踢出某个会话 |
| GET | `/password-score` | 密码强度评分 |
| GET | `/settings` | 公开站点设置 |
| PATCH | `/settings` | 修改站点设置（仅管理员） |

### 博客

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/posts` | 列表：`page/size/q/tag/category/sort/status/author/bookmarked` |
| GET | `/posts/featured` | 精选文章 |
| GET | `/posts/:idOrSlug` | 详情（id 或 slug 均可，30 分钟同 IP 只计一次浏览） |
| POST | `/posts` | 新建（`draft` / `published`） |
| PUT | `/posts/:id` | 更新 |
| DELETE | `/posts/:id` | 删除 |
| POST | `/posts/:id/like` | 点赞 / 取消 |
| POST | `/posts/:id/bookmark` | 收藏 / 取消 |
| GET/POST/PATCH/DELETE | `/categories`、`/tags` | 分类与标签 |
| GET | `/posts/:id/comments` | 评论列表（支持 slug） |
| POST | `/posts/:id/comments` | 发表评论（游客需 `guestName`，进入待审核） |
| PATCH/DELETE | `/comments/:id` | 编辑 / 删除评论 |
| POST | `/comments/:id/like` | 评论点赞 |

### 笔记 / 待办 / 书签

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/notes` | 列表（含搜索、置顶）/ 新建 |
| GET/PATCH/DELETE | `/notes/:id` | 单条操作 |
| GET/POST | `/todos` | 列表 / 新建 |
| PATCH/DELETE | `/todos/:id` | 更新 / 删除 |
| POST | `/todos/:id/toggle` | 切换完成 |
| POST | `/todos/clear-completed`、`/todos/reorder` | 清理 / 排序 |
| GET/POST | `/links` | 书签列表 / 新建 |
| PATCH/DELETE | `/links/:id` | 更新 / 删除 |
| POST | `/links/:id/click` | 记录点击 |

### 短链 / 文件 / 其它

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/shorts` | 我的短链 / 新建（可自定义短码） |
| PATCH/DELETE | `/shorts/:id` | 停用 / 删除 |
| GET/POST | `/files` | 文件列表（含用量与目录）/ 上传 |
| PATCH/DELETE | `/files/:id` | 改信息 / 删除 |
| POST | `/subscribe` | 邮件订阅 |
| GET | `/export` | 导出个人数据（JSON 附件） |
| GET | `/health` | 健康检查 |

### 公开数据

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/search?q=` | 聚合搜索 |
| GET | `/users`、`/users/:username` | 用户列表 / 主页数据 |
| GET | `/chat/history`、`POST /chat/messages` | 聊天室历史 / 发送（REST 兜底） |
| GET | `/stats/overview`、`/stats/dashboard`、`/stats/trend`、`/stats/heatmap`、`/stats/leaderboard` | 统计与图表数据 |

### 管理后台（仅管理员）

`GET /admin/overview`、`GET /admin/comments?status=`、`PATCH /admin/comments/:id`、`GET /admin/events`、`POST /admin/users/:id/role`、`DELETE /admin/users/:id`、`POST /admin/posts/:id/feature`、`POST /admin/settings`、`POST /admin/chat/clear`、`GET /admin/database`、`POST /admin/maintenance/vacuum`

</details>

---

## WebSocket 协议

连接 `ws://<host>/ws`，可用 `?token=<jwt>`、`Authorization: Bearer <jwt>` 请求头或 `hub_token` Cookie 识别身份。

**服务端 → 客户端**

```jsonc
{ "type": "ready", "you": { "id": "…", "nickname": "…", "authenticated": true }, "online": 2, "messages": [ … ] }
{ "type": "presence", "online": 3, "joined": "游客-1234" }
{ "type": "message", "message": { "id": "…", "room": "lobby", "kind": "chat", "body": "…", "nickname": "…", "isMe": false, "createdAt": "…" } }
{ "type": "error", "message": "发送太快了，歇一会儿" }
```

**客户端 → 服务端**

```jsonc
{ "type": "chat", "body": "你好" }
{ "type": "chat", "body": "/help" }
```

聊天指令：`/help`（帮助）、`/who`（当前在线人数）、`/time`（服务器时间）、`/me 动作`。管理后台的「清空聊天室」按钮会删除全部聊天记录。

---

## 数据表

`users`、`posts`、`categories`、`tags`、`post_tags`、`comments`、`reactions`、`bookmarks`、`notes`、`todos`、`links`、`short_links`、`files`、`messages`、`sessions`、`subscribers`、`events`、`settings`、`_migrations`

迁移在 `server/db.js` 中按 `NNN_名称` 顺序执行，已应用的记录写入 `_migrations`，重复启动不会重复建表。

---

## 安全与健壮性

- 密码使用 `scrypt` 加盐哈希；JWT 为自实现 HS256，token 绑定 `sessions` 表，登出即刻失效
- 全站安全响应头：`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`X-DNS-Prefetch-Control` 等
- 静态资源路径穿越防护，目录外文件不可访问
- 接口限流：全局 1200 次 / 分钟（仅统计 `/api`），登录注册 20 次 / 分钟，聊天室发言 8 条 / 5 秒
- 上传大小、JSON 深度、字段长度与枚举值统一在 `server/lib/validate.js` 校验
- 优雅退出：`SIGINT` / `SIGTERM` 关闭 WebSocket 连接后退出

---

## 冒烟测试

```bash
npm run smoke
```

脚本会在随机端口启动一个使用**临时数据库与临时上传目录**的实例，覆盖静态资源、注册登录、会话、文章增删改查、点赞收藏、评论与审核、笔记 / 待办 / 书签、文件上传删除、短链跳转与统计、订阅、导出、搜索、统计接口、WebSocket 双客户端收发与管理后台，全部通过后自动清理临时数据并删除实例。
