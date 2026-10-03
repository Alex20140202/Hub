# Hub 超级中心

> 用 **Node.js 双端** 写的全栈综合站点：博客、笔记、待办、书签、文件、短链、**支持建群/拉人/私聊/传文件的实时聊天室**、积分商城、站内搜索与管理后台，全部跑在**一个进程**里，**零第三方依赖**（`node_modules` 是空的）。

- 运行时：`node:http` + `node:sqlite` + `node:crypto`，外加**手写 RFC 6455 WebSocket**
- 渲染：服务端输出完整 HTML（可被搜索引擎抓取），客户端用 History API 局部替换
- 构建：`scripts/build.js` 用 Node 合并压缩 CSS、复制 ES Module、生成版本清单
- 首屏即有内容：3 个演示账号、6 篇文章、评论、笔记、待办、书签、短链、聊天记录与积分流水

---

## 快速开始

需要 **Node.js >= 22.5**（用到内置的 `node:sqlite`，推荐 24 / 26 LTS）。

```bash
node -v
npm start          # 首次会自动建库、执行迁移、写入种子数据
```

默认地址 <http://localhost:4000>。

```bash
npm run dev        # 构建 + node --watch 热重启
npm test           # 冒烟测试（196 项，使用临时数据库，不污染 data/）
npm run build      # 只构建前端资源
npm run reset      # 删库重建 + 重新写入种子数据
npm run seed       # 仅在数据库为空时写入种子数据
```

### 内置账号

| 角色 | 邮箱 | 密码 | 说明 |
| --- | --- | --- | --- |
| 管理员 | `admin@hub.dev` | `admin12345` | 可进管理后台 |
| 演示用户 | `demo@hub.dev` | `demo12345` | 自带文章 / 笔记 / 待办 / 书签 / 积分 |
| 体验账号 | `lin@hub.dev` | `linpass123` | 第二位作者，可看多人内容流 |

> 生产环境请务必用环境变量覆盖并修改密码。

---

## 功能

| 模块 | 路径 | 能力 |
| --- | --- | --- |
| 首页 | `/` | 站点统计、精选 / 最新 / 热门文章、热门标签与分类、我的各模块入口、订阅入口 |
| 博客 | `/blog` | 列表 / 详情 / 分类 / 标签 / 四种排序 / 搜索 / 分页、草稿、精选、阅读量、点赞、收藏 |
| 写作 | `/blog/new`、`/blog/:id/edit` | Markdown 编辑器、**服务端渲染的实时预览**、标签分类、存草稿或发布 |
| 笔记 | `/notes` | 标签、颜色标记、置顶、搜索、详情页 |
| 待办 | `/todos` | 优先级分组、截止日期、进度条、完成统计、批量清理、拖拽排序 |
| 书签 | `/links` | 标签归类、标星、点击统计、搜索与排序 |
| 文件 | `/files` | 拖拽上传、目录归档、用量统计（受商城扩容影响）、下载删除、设为公开分享（`/d/:id`） |
| 短链 | `/short` | 自定义短码（冲突自动加后缀）、点击统计、停用/启用 |
| 聊天室 | `/chat` | 见下方「聊天室」章节：大厅 + 群聊 + 私聊、拉人踢人、**引用回复 / 群公告 / 房间搜索 / 已读回执 / 免打扰 / 历史分页**、文件传输、消息撤回 |
| 积分中心 | `/points` | 每日签到、28 天签到日历、积分流水、排行榜、**29 件商城道具**（皮肤 / 头像框 / 称号 / 勋章 / 存储 / 一次性道具），兑换即生效 |
| 搜索 | `/search` | 跨文章 / 笔记 / 待办 / 书签 / 文件聚合检索，可限定范围 |
| 用户主页 | `/u/:username` | 他人资料、公开文章与统计 |
| 设置 | `/settings` | 资料、密码、主题、登录设备管理、数据导出；管理员另有站点设置 |
| 管理后台 | `/admin` | 总览、用户与角色、评论审核、站点设置、短链与商城总览 |
| 命令面板 | `⌘K` / `Ctrl+K` / `/` | 全站命令与内容搜索 |

其它细节：明暗 / 跟随系统三态主题、6 套主题色、快捷键（`g`+字母 跳模块、`⌘N` 快速新建）、响应式布局、键盘可达（跳转链接、模态框焦点陷阱、`Esc` 关闭）、Toast 提示、乐观勾选、密码强度提示。

---

## 界面：Liquid Glass

全站采用玻璃质感（Liquid Glass）语言，定义在 `client/css/glass.css`：

- **玻璃层** = 半透明底 + `backdrop-filter: blur() saturate()` + 内侧镜面高光 + 分层投影
- **边缘折射**：用 `padding: 1px` + `mask-composite: exclude` 抠出 1px 渐变描边，顶端更亮以模拟受光
- **体积感**：卡片内叠一层柔光斑，`.stat` 叠彩色折射条
- **背景光场**：`body` 上三段固定（`background-attachment: fixed`）的柔和光斑，给玻璃提供可折射的内容
- **深度**：卡片 hover 上浮 + 阴影加深；模态框与 Toast 用更强模糊（40px）与更高不透明度
- **动效**：入场用 `glass-in`（位移 + 缩放 + 模糊消散），顶栏有一道极轻的扫光
- **可降级**：不支持 `backdrop-filter` 的浏览器自动退回实色；`prefers-reduced-motion` 下关闭动画
- **双主题**：暗色下玻璃更通透、边缘高光更亮（`--glass-tint` 与 `--glass-edge` 分别调参）

---

## 架构：一个进程，两端协作

```
浏览器 ──GET /todos──▶ Node 服务
   │                      │
   │  ◀── 完整 HTML ───────┤  ① 首屏：服务端渲染
   │                      │
   │  ──GET /todos?_partial=1 ─▶  ② 换页：只要片段
   │  ◀── HTML 片段 ────────┤
   │                      │
   │  ──POST /api/* ───────▶  ③ 写操作：JSON 接口
   │                      │
   │  ══WS /ws═══════════▶  ④ 聊天室：同端口 WebSocket
```

**服务端是页面标记的唯一来源。** 客户端不做二次渲染，只负责：拦截站内链接请求片段、提交表单与调接口、命令面板、主题切换、Toast 与模态框、WebSocket 收发。

**任何写操作成功后都要重新拉取片段**（`client/js/lib/view.js` 的 `refreshView()`），由服务端重新渲染当前视图，而不是在客户端各处手动改 DOM——这是「服务端唯一渲染源」的关键一环，漏掉任何一处都会导致「操作成功但界面不动，必须刷新才看到」。冒烟测试里的「视图刷新契约」一节会逐个校验所有弹窗与删除/切换类动作都调用了它。

这样避免了「同一份视图写两遍」的常见漂移。冒烟测试里有一条**双端契约检查**：页面上出现的每个 `data-action` / `data-form` 都必须有对应的客户端处理器 —— 改页面忘改 JS 会直接测试失败。

**Markdown 也只有一份实现**（`server/views/markdown.js`），编辑器预览走 `POST /api/preview`，所见即线上渲染。

### 目录结构

```
.
├── server/                  # 后端（零依赖）
│   ├── index.js             # 入口：建库、种子、监听、WS 升级、优雅退出
│   ├── app.js               # 请求装配：静态资源 → 限流 → 路由 → SSR → 错误页
│   ├── config.js            # 配置与 .env 解析
│   ├── db.js                # node:sqlite 封装：迁移、查询 helper、事务
│   ├── migrations.js        # 表结构（按顺序执行，已应用的记入 _migrations）
│   ├── http/                # 路由器、请求体与 multipart 解析、静态资源、响应封装
│   ├── lib/                 # scrypt 密码、HMAC 会话令牌、校验、限流、slug、日志
│   ├── models/              # users / notes / todos / links / files / posts / shorts / points / chat / stats / search / seed
│   ├── routes/              # auth、workspace、blog（文章/评论/积分/分类）、shorts（短链/订阅/首页）
│   ├── views/               # 服务端渲染：layout、pages、blog、modules、markdown、shared
│   └── ws/                  # 手写 WebSocket：帧编解码 + 聊天室逻辑
├── client/                  # 前端源码（构建到 public/assets/）
│   ├── css/                 # tokens / base / layout / components / modules
│   └── js/
│       ├── main.js          # 导航、事件委托、主题、拖拽上传、快捷键
│       ├── lib/             # api、dom、format
│       └── ui/              # toast、modal、palette、forms、chat
├── scripts/                 # build.js / smoke.js / reset.js
├── data/                    # 运行时生成：hub.db 与 uploads/（已 gitignore）
└── public/                  # 构建产物与静态文件
```

---

## HTTP 接口

认证挂在 `/api/auth` 下，其余在 `/api` 下。写操作依赖会话 Cookie `hub_session`，也接受 `Authorization: Bearer <token>`。

<details>
<summary>接口清单（点击展开）</summary>

### 认证 `/api/auth`

`POST /register` `POST /login` `POST /logout` `GET /me` `PATCH /me` `POST /password` `GET /password-score` `GET /sessions` `DELETE /sessions/:id`

### 博客

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/posts` | `q`/`tag`/`category`/`sort`/`page`/`size` |
| GET | `/api/posts/featured`、`/api/posts/meta` | 精选文章、分类与热门标签 |
| GET | `/api/posts/:idOrSlug` | 详情（id 或 slug），同 IP 30 分钟只计一次浏览 |
| POST/PUT/DELETE | `/api/posts[/:id]` | 新建 / 更新 / 删除（`draft` / `published`） |
| POST | `/api/posts/:id/like`、`/bookmark` | 点赞 / 收藏 |
| GET | `/api/bookmarks` | 我的收藏 |
| GET/POST | `/api/posts/:id/comments` | 评论列表 / 发表评论（游客进待审核） |
| POST/PATCH/DELETE | `/api/comments/:id[...]/like` | 评论点赞 / 编辑 / 删除 |
| GET/POST/PATCH/DELETE | `/api/categories[/:id]` | 分类管理（增删改需管理员） |
| POST | `/api/preview` | Markdown 渲染（编辑器预览） |

### 工作区

`/api/notes` `/api/todos`（含 `reorder`、`clear-completed`）`/api/links`（含 `click`）`/api/files`（上传下载删除）

### 聊天室

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/rooms` | 我加入的群 + 我的私聊线程（含未读数与最后一条消息） |
| GET | `/api/rooms/discover` | 可加入的公开群（含是否已加入） |
| GET | `/api/rooms/:code/messages`、`/members` | 房间历史 / 成员列表与我的角色 |
| POST/PATCH/DELETE | `/api/rooms[/:code]` | 建群 / 改资料 / 解散（群主） |
| POST | `/api/rooms/:code/join`、`/leave` | 加入 / 退出 |
| POST/PATCH/DELETE | `/api/rooms/:code/members[/:userId]` | 拉人 / 改角色 / 踢人 |
| POST | `/api/rooms/:code/read` | 标记已读 |
| GET/POST | `/api/dms` | 可私聊用户与会话列表 / 发起私聊 |
| GET | `/api/rooms/:code/search?q=` | 房间内消息搜索 |
| POST/DELETE | `/api/rooms/:code/pin` | 置顶 / 取消置顶群公告 |
| POST | `/api/rooms/:code/mute` | 免打扰开关 |
| POST | `/api/rooms/:code/seen` | 上报已读回执 |
| GET | `/api/messages/:id/reads` | 查询某条消息的已读名单 |
| GET | `/api/attachments/:fileId` | 下载聊天附件（需为发件人或房间成员） |

### 短链 / 社区

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST/PATCH/DELETE | `/api/shorts[/:id]` | 短链管理 |
| GET | `/s/:code` | 短链跳转（302 + 点击统计） |
| GET | `/d/:id` | 公开文件下载（仅公开文件） |
| POST | `/api/subscribe` | 邮件订阅 |
| GET | `/api/home` | 站点首页聚合数据 |
| GET | `/api/health` | 健康检查 |

### 积分与商城

`GET /api/points/overview` `POST /api/points/checkin` `GET /api/points/logs` `GET /api/points/leaderboard` `GET /api/shop/items` `GET /api/shop/mine` `POST /api/shop/redeem/:itemId` `POST /api/shop/use/:ownedId`

### 管理端（仅管理员）

`GET /api/admin/overview` `GET /api/admin/users` `POST /api/admin/users/:id/role` `DELETE /api/admin/users/:id` `GET|PATCH /api/admin/settings`

</details>

---

## 聊天室

一条 WebSocket 连接可以**同时订阅多个房间**，每个房间独立广播。

| 能力 | 说明 |
| --- | --- |
| 公共大厅 | 所有人可见，游客可只读；`/help` `/who` `/time` `/me 动作` 指令 |
| 群聊 | 创建、改名改简介、设管理员、踢人、退群、解散；人数上限；公开群可被「发现」并加入，私密群仅成员可见 |
| 私聊 | 任意两位用户之间的独立会话，房间码为 `dm-<小 id>-<大 id>`，因此 A→B 与 B→A 落在同一房间；**第三方无法进入** |
| 拉人 | 成员及以上权限可邀请用户进群，邀请与进群都会写入系统消息并实时广播 |
| **引用回复** | 鼠标悬停消息点 ↩，输入框上方出现引用条；引用块会渲染被引消息的作者与摘要。**服务端校验引用必须同房间**，跨房间引用会被静默丢弃，避免私聊内容通过群聊泄露 |
| **群公告** | 悬停消息点 📌 设为公告，同一房间只保留一条；公告常驻在聊天区顶部，可一键取消 |
| **房间搜索** | 顶部「搜索」展开，只搜当前房间（不跨房间，避免泄露私聊）；结果可点击定位并高亮 |
| **已读回执** | 进入房间自动上报最近消息的已读；消息右下角显示「N 已读」，他人已读会实时更新 |
| **免打扰** | 🔔/🔕 按房间设置，群列表中标记，接口 `/api/rooms` 返回 `muted` 列表 |
| **历史分页** | 滚到顶部自动加载更早消息（游标分页），保持滚动位置不跳动；全部加载完显示「已经是最早的消息了」 |
| **日期分隔线** | 跨天自动插入「今天 / 昨天 / 具体日期」分隔条 |
| 文件传输 | 📎 按钮或直接把文件拖进聊天区；先走文件接口上传，再以 `attach` 消息发出 |
| 未读 | 群聊与私聊各自维护已读水位，切换房间自动标记，房间列表显示未读数 |
| 撤回 | 可撤回自己的消息；管理员可撤回任意消息 |

**文件权限**：聊天附件不是公开图床。下载接口 `/api/attachments/:id` 只对「发件人本人」或「所在房间的成员」开放，其余一律 403。

### WebSocket 协议

连接 `ws://<host>/ws`，通过同源 Cookie 识别身份。

**客户端 → 服务端**

```jsonc
{ "type": "join",   "room": "g-xxxxxxxx" }   // 加入并切换到该房间（可多次，累积订阅）
{ "type": "leave",  "room": "g-xxxxxxxx" }   // 退出房间
{ "type": "switch", "room": "g-xxxxxxxx" }   // 切换当前房间
{ "type": "chat",   "body": "你好", "replyTo": 88 }  // 发言 / 引用回复 / 指令
{ "type": "attach", "fileId": 12 }           // 发送已上传的附件
{ "type": "read",   "room": "g-xxxxxxxx" }   // 标记已读
{ "type": "seen",    "room": "g-xxxxxxxx", "messageIds": [88, 89] }  // 已读回执
{ "type": "delete", "messageId": 88 }        // 撤回
```

**服务端 → 客户端**

```jsonc
{ "type": "ready",   "you": {...}, "online": 3, "messages": [ … ] }   // 连接就绪（大厅历史）
{ "type": "room",    "room": "g-xxxxxxxx", "online": 2, "pinned": {…}, "muted": false, "hasMore": true, "messages": [ … ] }
{ "type": "left",    "room": "g-xxxxxxxx", "active": "lobby" }
{ "type": "presence","room": "g-xxxxxxxx", "online": 4, "total": 9 }
{ "type": "pinned",   "room": "g-xxxxxxxx", "pinned": {…} | null }
{ "type": "seen",     "room": "g-xxxxxxxx", "readerId": 7, "messageIds": [88] }
{ "type": "mute",     "room": "g-xxxxxxxx", "userId": 7, "muted": true }
{ "type": "message", "room": "g-xxxxxxxx", "message": { … } }
{ "type": "members-changed", "room": "g-xxxxxxxx" }
{ "type": "room-update" | "room-closed" | "deleted" | "error" }
```

房间可见性与发言权限统一由 `server/models/rooms.js` 的 `accessOf` / `isMember` 判定，HTTP 接口与 WebSocket 共用同一套规则，避免出现「接口说能进、WS 说不能发」的不一致。

---

## 积分体系

| 行为 | 积分 | 每日上限 |
| --- | --- | --- |
| 注册 | +20 | 1 次 |
| 每日签到 | +5（连签 3 天起 +5，满 7 天再 +10） | 1 次 |
| 发布文章 | +20 | 20 次 |
| 发表评论 | +3 | 10 次 |
| 上传文件 | +5 | 20 次 |
| 新建笔记 / 完成待办 | +2 | 各 20 次 |
| 创建短链 | +1 | 20 次 |
| 文章被点赞 | +1 | 50 次 |
| 评论被点赞 | +2 | 30 次 |

### 商城（29 件）

| 类型 | 数量 | 兑换后 |
| --- | --- | --- |
| 主题皮肤 | 8 | 立即切换整站配色（`data-skin`），与明暗模式自由组合 |
| 头像框 | 5 | 个人中心 / 主页 / 成员列表头像显示对应描边 |
| 称号 | 6 | 显示在昵称旁（侧边栏、评论区、成员列表） |
| 勋章 | 4 | 收集展示在个人中心的勋章墙 |
| 存储扩容 | 3 | 永久提高文件配额（基数 200MB + 加成） |
| 一次性道具 | 3 | 改名券、文章置顶卡、幸运 Cookie（随机 50-300 分） |

**兑换即生效**：皮肤 / 头像框 / 称号 / 存储属唯一类，兑换时在事务内自动装备，不需要再手动点一次「使用」；已生效的道具在商城里显示「已装备」，再买同类型会变成「切换」。限量道具售罄即止。

---

## 环境变量

全部可选，均有默认值（见 `.env.example`）。开发环境 `JWT_SECRET` 缺省时按项目路径派生，重启后会话仍有效；**生产环境不设置会直接启动失败**。

```bash
NODE_ENV=production JWT_SECRET=$(openssl rand -hex 32) PORT=4000 npm start
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` / `HOST` | `4000` / `127.0.0.1` | 监听地址，局域网访问设 `HOST=0.0.0.0` |
| `NODE_ENV` | `development` | `production` 时隐藏错误详情、强制要求 `JWT_SECRET` |
| `JWT_SECRET` | 开发环境按路径派生 | 会话签名密钥 |
| `DB_FILE` / `UPLOAD_DIR` | `data/hub.db` / `data/uploads` | 数据与上传目录 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@hub.dev` / `admin12345` | 种子管理员 |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | `demo@hub.dev` / `demo12345` | 种子演示账号 |
| `MAX_UPLOAD_BYTES` | `26214400` | 单文件上限（25 MiB） |
| `TOKEN_TTL_HOURS` | `336` | 会话有效期（14 天） |
| `COOKIE_SECURE` / `LOG_LEVEL` | `false` / `debug` | HTTPS 部署 / 日志级别 |

---

## 数据表

`users` `sessions` `notes` `todos` `links` `files` `events` `settings` `categories` `tags` `posts` `post_tags` `comments` `reactions` `bookmarks` `short_links` `point_logs` `checkins` `shop_items` `user_items` `messages` `rooms` `room_members` `dm_threads` `dm_reads` `subscribers` `_migrations`

最近三条迁移：`008_chat_rooms`（房间、成员、消息附件、私聊线程与已读）、`009_cosmetics`（皮肤、称号、存储加成）、`010_chat_v2`（消息回复引用、房间置顶公告、成员免打扰、消息已读回执）。

迁移在 `server/migrations.js` 中按数组顺序执行，已应用的记录写入 `_migrations`。新增结构请**追加新条目**，不要修改已发布的条目。

---

## 安全与健壮性

- 密码 `scrypt` 加盐哈希（N=16384），校验走 `timingSafeEqual`
- 会话令牌为自实现 HS256 签名，绑定 `sessions` 表，登出 / 改密即刻失效
- 全站安全响应头，含 `Cross-Origin-Opener-Policy`
- 静态资源 ETag + 304，路径穿越拒绝；带扩展名的缺失资源直接 404，不会被页面兜底
- 上传文件名随机化存储，下载名 `filename*=UTF-8''` 编码，存储路径限定在上传目录内
- Markdown 渲染只放行 `http` / `https` / `mailto` 与站内相对地址，`javascript:` 降级为 `#`
- 链接只接受 `http` / `https`
- 限流：登录注册 20 次/分、接口 900 次/分、评论 10 次/分、发布 20 次/分、聊天 8 条/5 秒
- `?next=` 重定向只接受站内相对路径，避免开放重定向
- 游客评论与文件默认私有 / 待审核；越权访问一律返回 404
- 优雅退出：`SIGINT` / `SIGTERM` 先关监听再退出

---

## 测试

```bash
npm test
```

在随机端口启动一个使用**临时数据库与临时上传目录**的实例，覆盖 **322 项**检查：静态资源与路径穿越、认证全流程、SSR 首屏与片段、博客增删改查与越权、评论与审核、点赞收藏、短链跳转与冲突、积分签到与每日上限、商城兑换与权益生效、文件上传落盘与公开分享、订阅、管理端权限、**建群/拉人/踢人/退群/解散/私聊隔离/附件下载权限**、**商城扩充与兑换生效**、**聊天室增强**（置顶公告 / 房间搜索 / 免打扰 / 跨房间引用拦截 / 非成员置顶拦截）、**视图刷新契约**、**SSR 片段禁止缓存**、**双端契约一致性**。全部通过后自动清理。

交互层另有 Chrome DevTools Protocol 脚本验证：
- 写操作即时生效（21 项）：新建/勾选/标星/删除/签到/切换侧栏/前进后退后是否立即更新、是否发生整页刷新、`<main>` 外壳是否完好
- 聊天室增强（19 项）：引用回复、群公告、房间搜索、免打扰、日期分隔线、悬浮操作、玻璃材质是否真的生效

WebSocket 部分另有双客户端脚本级验证（两个连接同时收发、大厅与私聊消息不串房、非成员发言被拒、附件广播与下载权限、撤回权限）。

浏览器验收用 Chrome DevTools Protocol 跑过全部页面，确认零控制台错误；聊天室的群消息、私聊、文件卡片、商城与装饰生效均已逐页截图核对。

---

## 备注

- 更早的一版实现（更多页面与实验性功能）仍可从 git 历史 `c6924e1^` 取回，本仓库是重写版本。
