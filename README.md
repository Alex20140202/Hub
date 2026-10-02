# Hub 超级中心

> 用 **Node.js 双端** 写的全栈个人工作台：服务端直接渲染页面，客户端接管交互。仪表盘、笔记、待办、书签、文件、站内搜索与管理后台全部跑在**一个进程**里，**零第三方依赖**（`node_modules` 是空的）。

- 运行时：`node:http` + `node:sqlite` + `node:crypto`，没有任何 npm 包
- 渲染：服务端输出完整 HTML（可被搜索引擎抓取），客户端用 History API 局部替换
- 构建：`scripts/build.js` 用 Node 合并压缩 CSS、复制 ES Module、生成版本清单

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
npm test           # 冒烟测试（131 项，使用临时数据库，不污染 data/）
npm run build      # 只构建前端资源
npm run reset      # 删库重建 + 重新写入种子数据
npm run seed       # 仅在数据库为空时写入种子数据
```

### 内置账号

| 角色 | 邮箱 | 密码 |
| --- | --- | --- |
| 管理员 | `admin@hub.dev` | `admin12345` |
| 演示用户 | `demo@hub.dev` | `demo12345` |

> 演示账号自带示例笔记、待办与书签，适合直接看效果。生产环境请务必用环境变量覆盖并修改密码。

---

## 架构：一个进程，两端协作

```
浏览器 ──GET /todos──▶ Node 服务
   │                      │
   │  ◀── 完整 HTML ───────┤  ① 首屏：服务端渲染（SSR）
   │                      │
   │  ──GET /todos?_partial=1 ─▶  ② 换页：只要页面片段
   │  ◀── HTML 片段 ────────┤
   │                      │
   │  ──POST/PATCH /api/* ─▶  ③ 写操作：JSON 接口
```

**服务端是页面标记的唯一来源。** 客户端不做二次渲染，只负责：

- 拦截站内链接 → 请求 `?_partial=1` 片段 → 替换 `#main`
- 表单提交、勾选、拖拽上传等交互 → 调 `/api/*` → 再刷新片段
- 命令面板、主题切换、Toast、模态框

这样避免了「同一份视图写两遍」的常见漂移，冒烟测试里也加了一条**双端契约检查**：页面上出现的每个 `data-action` / `data-form` 都必须有对应的客户端处理器。

### 目录结构

```
.
├── server/                  # 后端（零依赖）
│   ├── index.js             # 入口：建库、种子、监听、优雅退出
│   ├── app.js               # 请求装配：静态资源 → 限流 → 路由 → SSR → 错误页
│   ├── config.js            # 配置与 .env 解析
│   ├── db.js                # node:sqlite 封装：迁移、查询 helper、事务
│   ├── migrations.js        # 表结构（按数组顺序执行，已应用的记入 _migrations）
│   ├── http/                # 路由器、请求体与 multipart 解析、静态资源、响应封装
│   ├── lib/                 # scrypt 密码、HMAC 会话令牌、校验、限流、日志
│   ├── models/              # 数据访问层（users / notes / todos / links / files / stats / search / seed）
│   ├── routes/              # auth、workspace（笔记待办书签文件）、dashboard（含搜索与管理端）
│   └── views/               # 服务端渲染：layout 外壳、pages 各页面、html 与格式化工具
├── client/                  # 前端源码（构建到 public/assets/）
│   ├── css/                 # tokens / base / layout / components
│   └── js/
│       ├── main.js          # 导航、事件委托、主题、拖拽上传、快捷键
│       ├── lib/             # api、dom、format
│       └── ui/              # toast、modal、palette、forms
├── scripts/
│   ├── build.js             # 前端构建
│   ├── smoke.js             # 冒烟测试
│   └── reset.js             # 数据库维护
├── data/                    # 运行时生成：hub.db 与 uploads/（已在 .gitignore）
└── public/                  # 构建产物与静态文件
```

---

## 功能

| 模块 | 路径 | 能力 |
| --- | --- | --- |
| 仪表盘 | `/` | 笔记/待办/书签/文件概览、14 天活跃趋势 SVG、最近笔记、待办、常用书签与活动流 |
| 笔记 | `/notes`、`/notes/:id` | 标签、颜色标记、置顶、搜索、详情页 |
| 待办 | `/todos` | 优先级分组、截止日期、完成统计、进度条、批量清理 |
| 书签 | `/links` | 标签归类、标星、点击统计、搜索与排序 |
| 文件 | `/files` | 拖拽上传、目录归档、用量统计、下载与删除 |
| 搜索 | `/search` | 跨笔记 / 待办 / 书签 / 文件聚合检索，可限定范围 |
| 设置 | `/settings` | 资料、密码、主题、登录设备管理、数据导出（管理员另有站点设置） |
| 管理后台 | `/admin` | 总览、用户列表、角色调整、删除用户、站点设置 |
| 用户主页 | `/u/:username` | 他人资料与公开内容 |

其它细节：

- 明暗 / 跟随系统三态主题，6 套主题色，主题在样式应用前同步落定（不闪白）
- 命令面板 `⌘K` / `Ctrl+K` / `/`：跳页面、执行指令、搜内容
- 快捷键：`g` + `d/n/t/l/f/s` 跳转模块，`⌘N` 快速新建
- 响应式布局，窄屏折叠侧边栏并提供浮动新建按钮
- 键盘可达：跳转链接、模态框焦点陷阱、`Esc` 关闭
- 骨架之外的细节：乐观勾选、Toast 提示、密码强度提示、数据导出

---

## HTTP 接口

认证相关挂在 `/api/auth` 下，其余在 `/api` 下。请求与响应为 JSON（上传为 `multipart/form-data`）。写操作依赖会话 Cookie `hub_session`，也接受 `Authorization: Bearer <token>`。

### 认证 `/api/auth`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/register` | 注册（受站点开关与限流保护） |
| POST | `/login` | 登录 |
| POST | `/logout` | 登出并立即吊销当前会话 |
| GET | `/me` | 当前用户（未登录返回 `{user:null}`） |
| PATCH | `/me` | 昵称 / 用户名 / 简介 / 主题 / 主题色 / 头像色相 |
| POST | `/password` | 修改密码（校验旧密码，吊销其它会话） |
| GET | `/password-score` | 密码强度评分（0-4） |
| GET | `/sessions` | 登录设备列表 |
| DELETE | `/sessions/:id` | 下线某个设备 |

### 工作区

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/notes` | 列表（`q`/`tag`/`limit`/`offset`）/ 新建 |
| GET/PATCH/DELETE | `/api/notes/:id` | 详情 / 更新 / 删除 |
| GET | `/api/notes/tags` | 标签及数量 |
| GET/POST | `/api/todos` | 列表（`q`/`filter=all\|open\|today\|done`）/ 新建 |
| PATCH/DELETE | `/api/todos/:id` | 更新（含 `done` 切换）/ 删除 |
| POST | `/api/todos/reorder` | 按给定顺序写入 `position` |
| POST | `/api/todos/clear-completed` | 清理已完成 |
| GET/POST | `/api/links` | 列表（`q`/`tag`/`starred`/`sort`）/ 新建 |
| PATCH/DELETE | `/api/links/:id` | 更新 / 删除 |
| POST | `/api/links/:id/click` | 记录点击 |
| GET | `/api/links/tags` | 标签及数量 |
| GET/POST | `/api/files` | 列表（含 `storage` 用量与目录）/ 上传 |
| PATCH/DELETE | `/api/files/:id` | 改信息 / 删除（同时删磁盘文件） |
| GET | `/api/files/:id/download` | 下载 |

### 仪表盘、搜索与其它

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/dashboard` | 首屏所需的全部聚合指标 |
| GET | `/api/dashboard/heatmap` | 活动热力图格子 |
| GET | `/api/search?q=&scope=` | 聚合搜索（`scope=all\|note\|todo\|link\|file`） |
| GET | `/api/site` | 公开站点设置与统计 |
| GET | `/api/users`、`/api/users/:username` | 用户列表 / 公开主页数据 |
| GET | `/api/export` | 导出个人数据（JSON 附件） |
| GET | `/api/health` | 健康检查 |

### 管理端（仅管理员）

`GET /api/admin/overview`、`GET /api/admin/users`、`POST /api/admin/users/:id/role`、`DELETE /api/admin/users/:id`、`GET|PATCH /api/admin/settings`

---

## 环境变量

全部可选，均有默认值（见 `.env.example`）。开发环境 `JWT_SECRET` 缺省时按项目路径派生，重启后会话仍有效；**生产环境不设置会直接启动失败**。

```bash
NODE_ENV=production JWT_SECRET=$(openssl rand -hex 32) PORT=4000 npm start
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4000` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址，需要局域网访问设为 `0.0.0.0` |
| `NODE_ENV` | `development` | `production` 时隐藏错误详情、强制要求 `JWT_SECRET` |
| `JWT_SECRET` | 开发环境按路径派生 | 会话签名密钥 |
| `DB_FILE` | `data/hub.db` | SQLite 文件路径 |
| `UPLOAD_DIR` | `data/uploads` | 上传目录 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@hub.dev` / `admin12345` | 种子管理员 |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | `demo@hub.dev` / `demo12345` | 种子演示账号 |
| `MAX_UPLOAD_BYTES` | `26214400` | 单文件上限（25 MiB） |
| `TOKEN_TTL_HOURS` | `336` | 会话有效期（14 天） |
| `COOKIE_SECURE` | `false` | HTTPS 下设为 `true` |
| `LOG_LEVEL` | `debug` | `debug` / `info` / `warn` / `error` |

---

## 数据表

`users`、`sessions`、`notes`、`todos`、`links`、`files`、`events`、`settings`、`_migrations`

迁移在 `server/migrations.js` 中按数组顺序执行，已应用的记录写入 `_migrations`，重复启动不会重复建表。新增结构请**追加新条目**，不要修改已发布的条目。

---

## 安全与健壮性

- 密码 `scrypt` 加盐哈希（N=16384），校验走 `timingSafeEqual`
- 会话令牌为自实现 HS256 签名，绑定 `sessions` 表，登出 / 改密即刻失效
- 全站安全响应头：`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Cross-Origin-Opener-Policy`
- 静态资源 ETag + 304 协商，路径穿越一律拒绝；带扩展名的缺失资源直接 404，不会被页面兜底
- 上传文件名随机化存储、下载名 `filename*=UTF-8''` 编码，存储路径限定在上传目录内
- 链接只接受 `http` / `https`，`javascript:` 等协议在服务端被拒
- 限流：登录注册 20 次 / 分钟，接口 900 次 / 分钟（仅统计 `/api`）
- 输入统一在 `server/lib/validate.js` 校验：字段长度、枚举、日期格式、标签数量
- `?next=` 重定向只接受站内相对路径，避免开放重定向
- 优雅退出：`SIGINT` / `SIGTERM` 关闭监听后退出

---

## 测试

```bash
npm test
```

脚本会在随机端口启动一个使用**临时数据库与临时上传目录**的实例，覆盖 131 项检查：

- 静态资源命中、缓存头、路径穿越拒绝、缺失资源 404
- 注册 / 登录 / 登出 / 弱密码拒绝 / 重复邮箱 / 改密后旧密码失效
- SSR 首屏含导航与状态注入、片段请求不含外壳、404 状态码、未登录跳转登录
- 笔记 / 待办 / 书签 / 文件的增删改查、字段校验、越权访问一律 404
- 聚合搜索、仪表盘聚合、导出附件
- 管理端权限、角色调整、不能改自己、站点设置生效
- 文件上传落盘与随机化命名、下载内容一致、删除后磁盘清理
- **双端契约一致性**：页面渲染出的 `data-action` / `data-form` 必须有客户端处理器

全部通过后自动清理临时数据并关闭实例。

---

## 备注

- 上一版实现（博客 / 积分 / 聊天室等）仍可从 git 历史 `c6924e1^` 取回，本仓库是重写版本。
- 端口 `3535` 可能仍被旧版进程占用，本项目默认用 `4000`。
