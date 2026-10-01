import { el, clear } from '../lib/dom.js';
import { AdminAPI, StatsAPI, PostAPI } from '../lib/api.js';
import { numberFmt, dateShort, timeAgo, humanSize } from '../lib/format.js';
import { avatar, badge, tabs, statCard, skeleton, empty, statusBadge } from '../ui/components.js';
import { lineChart, barChart, donutChart, chartLegend, heatmap } from '../ui/chart.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, modal, formDialog } from '../ui/modal.js';

const TABS = [
  { key: 'dashboard', label: '📊 总览' },
  { key: 'posts', label: '📄 内容' },
  { key: 'comments', label: '💬 评论审核' },
  { key: 'chat', label: '📨 聊天室' },
  { key: 'users', label: '👥 用户' },
  { key: 'links', label: '🔗 短链' },
  { key: 'shop', label: '🪙 积分商城' },
  { key: 'subscribers', label: '✉️ 订阅' },
  { key: 'settings', label: '⚙️ 站点设置' },
  { key: 'maintenance', label: '🛠 维护' },
];

export default async function adminView(host) {
  host.replaceChildren(skeleton(3));
  let current = 'dashboard';
  const panel = el('div');

  host.append(
    el('div.page-head', {}, [
      el('div.row-between.wrap', {}, [
        el('div', {}, [el('h1', {}, '管理后台'), el('p', {}, '站点数据、用户与内容管理')]),
        el('span.badge.badge-danger', {}, '仅管理员可见'),
      ]),
    ]),
    el('div.card', { style: { padding: '0 16px' } }, [
      el('div', { style: { overflowX: 'auto' } }, [
        tabs(TABS, current, (key) => {
          current = key;
          render();
        }),
      ]),
    ]),
    el('div', { style: { marginTop: '20px' } }, panel),
  );

  async function render() {
    clear(panel);
    panel.append(skeleton(2));
    try {
      if (current === 'dashboard') await renderDashboard();
      else if (current === 'posts') await renderPosts();
      else if (current === 'comments') await renderComments();
      else if (current === 'chat') await renderChat();
      else if (current === 'users') await renderUsers();
      else if (current === 'links') await renderLinks();
      else if (current === 'shop') await renderShop();
      else if (current === 'subscribers') await renderSubscribers();
      else if (current === 'settings') await renderSettings();
      else await renderMaintenance();
    } catch (err) {
      clear(panel);
      panel.append(el('div.alert.alert-danger', {}, err.message));
    }
  }

  /* ---------------- 总览 ---------------- */
  async function renderDashboard() {
    const [data, heat, dash] = await Promise.all([
      AdminAPI.overview(),
      StatsAPI.heatmap().catch(() => ({ items: [] })),
      StatsAPI.dashboard().catch(() => ({ trend: [], topPosts: [] })),
    ]);
    const s = data.stats;
    const top = dash.topPosts || [];

    clear(panel);
    panel.append(
      el('div.stat-grid', {}, [
        statCard({ label: '已发布文章', value: s.posts, icon: '📄', hint: `${s.drafts} 篇草稿` }),
        statCard({ label: '注册用户', value: s.users, icon: '👤' }),
        statCard({ label: '总阅读量', value: s.views, icon: '👁' }),
        statCard({ label: '评论', value: s.comments, icon: '💬', hint: `${s.pendingComments} 待审` }),
        statCard({ label: '短链点击', value: s.shortClicks, icon: '🔗', hint: `${s.shortLinks} 条` }),
        statCard({ label: '文件', value: s.files, icon: '📁', hint: humanSize(s.storage) }),
        statCard({ label: '聊天室消息', value: s.messages, icon: '💭' }),
        statCard({ label: '订阅用户', value: s.subscribers, icon: '✉️' }),
      ]),

      el('div.grid.grid-sidebar', { style: { marginTop: '20px' } }, [
        el('div.col', { style: { gap: '20px' } }, [
          el('div.card', {}, [
            el('div.card-title', {}, '📈 近 30 天活跃趋势'),
            lineChart(dash.trend || [], { height: 240 }),
          ]),
          el('div.card', {}, [
            el('div.card-title', {}, '🕓 行为类型分布'),
            data.types.length
              ? barChart(
                  data.types.slice(0, 10).map((t) => ({ label: t.type, value: t.c })),
                  { height: 220 },
                )
              : el('p.muted.small', {}, '暂无数据'),
          ]),
          el('div.card', {}, [
            el('div.card-title', {}, '🔥 热门内容'),
            top.length
              ? el('div.table-wrap', {}, [
                  el('table', {}, [
                    el('thead', {}, el('tr', {}, [
                      el('th', {}, '标题'),
                      el('th', {}, '作者'),
                      el('th', {}, '阅读'),
                      el('th', {}, '点赞'),
                      el('th', {}, '评论'),
                      el('th', {}, '发布时间'),
                    ])),
                    el('tbody', {}, top.map((p) =>
                      el('tr', {}, [
                        el('td', {}, el('a.truncate', {
                          href: `#/blog/${p.slug}`,
                          style: { maxWidth: '300px', display: 'block', color: 'var(--text)' },
                        }, p.title)),
                        el('td.small', {}, p.author?.nickname || p.author?.username || '—'),
                        el('td', {}, numberFmt(p.views)),
                        el('td', {}, String(p.likes ?? 0)),
                        el('td', {}, String(p.comment_count ?? p.comments ?? 0)),
                        el('td.small.muted', {}, dateShort(p.published_at)),
                      ]),
                    )),
                  ]),
                ])
              : el('p.muted.small', {}, '暂无内容数据'),
          ]),
        ]),
        el('div.col', { style: { gap: '16px' } }, [
          el('div.card', {}, [
            el('div.card-title', {}, '⚡ 待处理'),
            el('div.col', { style: { gap: '8px' } }, [
              actionRow('待审核评论', s.pendingComments, () => {
                current = 'comments';
                render();
              }),
              actionRow('草稿文章', s.drafts, () => {
                current = 'posts';
                render();
              }),
              actionRow('停用短链', data.shorts.filter((x) => !x.active).length, () => {
                current = 'links';
                render();
              }),
            ]),
          ]),
          el('div.card', {}, [
            el('div.card-title', {}, '🗓 活跃热力图（90 天）'),
            heatmap(heat.items || []),
          ]),
          el('div.card', {}, [
            el('div.card-title', {}, '📊 内容占比'),
            donutChart(
              [
                { label: '文章', value: s.posts },
                { label: '笔记', value: s.notes },
                { label: '待办', value: s.todos },
                { label: '书签', value: s.links },
                { label: '文件', value: s.files },
              ],
              { size: 160 },
            ),
            el('div', { style: { marginTop: '12px' } }, chartLegend([
              { label: '文章', value: s.posts },
              { label: '笔记', value: s.notes },
              { label: '待办', value: s.todos },
              { label: '书签', value: s.links },
              { label: '文件', value: s.files },
            ])),
          ]),
        ]),
      ]),
    );
  }

  function actionRow(label, count, onClick) {
    return el('button.row-between', {
      type: 'button',
      style: { width: '100%', padding: '8px 10px', borderRadius: '8px' },
      onclick: onClick,
    }, [
      el('span.soft', {}, label),
      badge(String(count), count > 0 ? 'warning' : ''),
    ]);
  }

  /* ---------------- 内容 ---------------- */
  async function renderPosts() {
    const data = await PostAPI.list({ page: 1, size: 20, status: 'all', sort: 'new' });
    clear(panel);
    panel.append(
      el('div.card', {}, [
        el('div.row-between', { style: { marginBottom: '12px' } }, [
          el('div.card-title', { style: { margin: '0' } }, `内容管理 · 共 ${data.total} 篇`),
          el('a.btn.btn-ghost.btn-sm', { href: '#/blog' }, '前台查看'),
        ]),
        el('div.table-wrap', {}, [
          el('table', {}, [
            el('thead', {}, el('tr', {}, [el('th', {}, '标题'), el('th', {}, '作者'), el('th', {}, '状态'), el('th', {}, '数据'), el('th', {}, '操作')])),
            el('tbody', {}, data.items.map((p) =>
              el('tr', {}, [
                el('td', {}, el('a.truncate', { href: `#/blog/${p.slug}`, target: '_blank', style: { maxWidth: '300px', display: 'block', color: 'var(--text)' } }, p.title)),
                el('td.small', {}, p.author.nickname || p.author.username),
                el('td', {}, badge(p.status === 'published' ? '已发布' : '草稿', p.status === 'published' ? 'success' : 'warning')),
                el('td.small.muted', {}, `👁 ${numberFmt(p.views)} · ♥ ${p.likes}`),
                el('td', {}, el('div.row', { style: { gap: '4px' } }, [
                  el('button.icon-btn', {
                    type: 'button',
                    title: p.featured ? '取消精选' : '设为精选',
                    onclick: async () => {
                      try {
                        await AdminAPI.feature(p.id);
                        toast.success('已更新精选状态');
                        render();
                      } catch (err) {
                        toast.error(err.message);
                      }
                    },
                  }, p.featured ? '⭐' : '☆'),
                  el('a.icon-btn', { href: `#/blog/${p.slug}/edit`, title: '编辑' }, '✏️'),
                  el('button.icon-btn', {
                    type: 'button',
                    title: '删除',
                    onclick: async () => {
                      if (!(await confirmDialog({ title: '删除文章', message: `确定删除《${p.title}》？`, confirmText: '删除', danger: true }))) return;
                      try {
                        await PostAPI.remove(p.id);
                        toast.success('已删除');
                        render();
                      } catch (err) {
                        toast.error(err.message);
                      }
                    },
                  }, '🗑'),
                ])),
              ]),
            )),
          ]),
        ]),
      ]),
    );
  }

  /* ---------------- 评论审核 ---------------- */
  async function renderComments() {
    const statuses = [
      { value: 'pending', label: '待审核' },
      { value: 'published', label: '已发布' },
      { value: 'spam', label: '垃圾' },
    ];
    let status = 'pending';
    const listNode = el('div');

    async function load() {
      listNode.replaceChildren(skeleton(2));
      const data = await AdminAPI.comments(status);
      clear(listNode);
      if (!data.items.length) {
        listNode.append(empty('没有待处理的评论', '', null, '✅'));
        return;
      }
      for (const c of data.items) {
        listNode.append(
          el('div.card.pad-sm', { style: { marginBottom: '10px' } }, [
            el('div.row.wrap', { style: { gap: '8px', marginBottom: '6px' } }, [
              avatar(c, 'sm'),
              el('strong', {}, c.nickname || c.username || c.guest_name || '匿名'),
              c.username ? el('span.small.muted', {}, `@${c.username}`) : el('span.small.muted', {}, '游客'),
              el('span.grow'),
              statusBadge(c.status),
              el('span.small.muted', {}, timeAgo(c.createdAt)),
            ]),
            el('div', { style: { whiteSpace: 'pre-wrap', fontSize: '0.9rem', marginBottom: '8px' } }, c.body),
            el('div.row-between.wrap', {}, [
              el('a.small.muted.truncate', { href: `#/blog/${c.postSlug}`, style: { maxWidth: '50%' } }, `在：${c.postTitle}`),
              el('div.row', { style: { gap: '6px' } }, [
                el('button.btn.btn-ghost.btn-sm', {
                  type: 'button',
                  onclick: async () => {
                    try {
                      await AdminAPI.setCommentStatus(c.id, 'published');
                      toast.success('已通过');
                      load();
                    } catch (err) {
                      toast.error(err.message);
                    }
                  },
                }, '✓ 通过'),
                el('button.btn.btn-ghost.btn-sm', {
                  type: 'button',
                  onclick: async () => {
                    try {
                      await AdminAPI.setCommentStatus(c.id, 'spam');
                      toast.success('已标记为垃圾');
                      load();
                    } catch (err) {
                      toast.error(err.message);
                    }
                  },
                }, '🚫 垃圾'),
                el('button.btn.btn-outline-danger.btn-sm', {
                  type: 'button',
                  onclick: async () => {
                    if (!(await confirmDialog({ title: '删除评论', message: '永久删除这条评论？', confirmText: '删除', danger: true }))) return;
                    try {
                      await PostAPI.removeComment(c.id);
                      toast.success('已删除');
                      load();
                    } catch (err) {
                      toast.error(err.message);
                    }
                  },
                }, '删除'),
              ]),
            ]),
          ]),
        );
      }
    }

    const filterRow = el('div.row.wrap', { style: { gap: '6px', marginBottom: '16px' } });
    const drawFilters = () => {
      clear(filterRow);
      for (const s of statuses) {
        const btn = el(`button.chip${status === s.value ? '.active' : ''}`, { type: 'button' }, s.label);
        btn.addEventListener('click', () => {
          status = s.value;
          drawFilters();
          load();
        });
        filterRow.append(btn);
      }
    };
    drawFilters();

    clear(panel);
    panel.append(
      el('div.card', {}, [
        el('div.card-title', {}, '评论审核'),
        filterRow,
        listNode,
      ]),
    );
    load();
  }

  /* ---------------- 聊天室 ---------------- */
  async function renderChat() {
    const data = await AdminAPI.chat();
    const rooms = data.rooms || [];
    const mutes = data.mutes || [];

    const q = el('input.input.input-sm.grow', { type: 'search', placeholder: '按昵称或内容搜索消息', 'aria-label': '搜索聊天消息' });
    const roomSel = el('select.select.input-sm', { 'aria-label': '筛选房间' }, [
      el('option', { value: '' }, '全部房间'),
      ...rooms.map((r) => el('option', { value: r.slug }, `${r.name}（${r.online} 在线）`)),
    ]);
    const listNode = el('div.chat-admin-list');
    const resultHint = el('div.small.muted');

    const loadMessages = async () => {
      clear(listNode).append(skeleton(2));
      try {
        const params = { limit: 40 };
        if (q.value.trim()) params.q = q.value.trim();
        if (roomSel.value) params.room = roomSel.value;
        const res = await AdminAPI.chatMessages(params);
        clear(resultHint).append(`命中 ${res.items?.length || 0} 条`);
        renderMessages(res.items || []);
      } catch (err) {
        clear(listNode).append(el('div.alert.alert-danger', {}, err.message));
      }
    };

    const renderMessages = (items) => {
      clear(listNode);
      if (!items.length) {
        listNode.append(empty('没有匹配的消息', '换个关键词试试', null, '🔍'));
        return;
      }
      for (const m of items) {
        listNode.append(
          el('div.chat-admin-item', {}, [
            el('div.chat-admin-head', {}, [
              el('strong', {}, m.nickname || '（已注销）'),
              el('span.tag.tag-sm', {}, m.room),
              m.userId ? el('span.tag.tag-sm', {}, `用户 ${m.userId}`) : el('span.tag.tag-sm', {}, '游客'),
              el('span.small.muted', {}, new Date(m.createdAt).toLocaleString('zh-CN')),
              m.editedAt ? el('span.tag.tag-sm', {}, '已编辑') : null,
              m.deleted ? el('span.tag.tag-sm', {}, '已删除') : null,
            ]),
            el('div.chat-admin-body', {}, m.deleted ? '（消息已删除）' : m.body),
            el('div.row.gap-1', {}, [
              // 禁言目标用稳定身份：登录用户给 userId，游客给 guestId
              m.userId
                ? el('button.btn.btn-ghost.btn-sm', {
                    type: 'button',
                    onclick: () => openMute(String(m.userId), m.nickname),
                  }, '禁言')
                : m.meta?.actor
                  ? el('button.btn.btn-ghost.btn-sm', {
                      type: 'button',
                      onclick: () => openMute(String(m.meta.actor).replace(/^g:/, ''), m.nickname),
                    }, '禁言')
                  : null,
              !m.deleted
                ? el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => clearOne(m) }, '清空本房间')
                : null,
            ]),
          ]),
        );
      }
    };

    const openMute = async (target, nickname) => {
      const values = await formDialog({
        title: `禁言 ${nickname || target}`,
        intro: '目标按稳定身份记录：登录用户用用户 ID，游客用访客标识，因此改名后依然有效。',
        fields: [
          { name: 'minutes', label: '禁言时长（分钟）', type: 'number', value: 10, min: 0, max: 10080, required: true, hint: '填 0 表示永久禁言' },
          { name: 'reason', label: '原因', value: '违反聊天室规范', maxlength: 80 },
        ],
        submitText: '禁言',
      });
      if (!values) return;
      try {
        await AdminAPI.muteChat(target, Number(values.minutes) || 0, values.reason);
        toast.success(`已禁言 ${nickname || target}`);
        mutesNode.replaceChildren(...(await AdminAPI.chat()).mutes.map(muteRow));
      } catch (err) {
        toast.error(err.message);
      }
    };

    const clearOne = async (m) => {
      const ok = await confirmDialog({
        title: '清空房间',
        message: `将删除「${m.room}」的全部消息与已读记录，且不可恢复。确定继续吗？`,
        confirmText: '清空',
        danger: true,
      });
      if (!ok) return;
      try {
        await AdminAPI.clearChat(m.room);
        toast.success(`已清空 ${m.room}`);
        loadMessages();
      } catch (err) {
        toast.error(err.message);
      }
    };

    const muteRow = (mt) =>
      el('div.chat-admin-item', {}, [
        el('div.chat-admin-head', {}, [
          el('strong', {}, mt.target),
          mt.until ? el('span.tag.tag-sm', {}, `至 ${new Date(mt.until).toLocaleString('zh-CN')}`) : el('span.tag.tag-sm', {}, '永久'),
          mt.reason ? el('span.small.muted', {}, mt.reason) : null,
        ]),
        el('div.row.gap-1', {}, [
          el('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            onclick: async () => {
              try {
                await AdminAPI.unmuteChat(mt.target);
                toast.success('已解除禁言');
                mutesNode.replaceChildren(...(await AdminAPI.chat()).mutes.map(muteRow));
              } catch (err) {
                toast.error(err.message);
              }
            },
          }, '解除'),
        ]),
      ]);

    const mutesNode = el('div.col');
    if (mutes.length) mutesNode.replaceChildren(...mutes.map(muteRow));
    else mutesNode.append(el('div.small.muted', {}, '当前没有禁言记录'));

    const roomRows = rooms.map((r) =>
      el('div.chat-admin-item', {}, [
        el('div.chat-admin-head', {}, [
          el('strong', {}, r.name),
          el('span.tag.tag-sm', {}, r.kind),
          el('span.small.muted', {}, r.online ? `${r.online} 人在线` : '无人在线'),
        ]),
        el('div.small.soft', {}, r.topic || '暂无主题'),
        el('div.row.gap-1', {}, [
          el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => openEditRoom(r) }, '编辑'),
          r.kind !== 'system'
            ? el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => removeRoom(r) }, '删除')
            : null,
        ]),
      ]),
    );

    const openEditRoom = async (room) => {
      const values = await formDialog({
        title: '编辑房间',
        fields: [
          { name: 'name', label: '房间名称', value: room.name, required: true, maxlength: 24 },
          { name: 'topic', label: '房间主题', value: room.topic, maxlength: 80 },
        ],
      });
      if (!values) return;
      try {
        await AdminAPI.updateChatRoom(room.slug, values);
        toast.success('已保存');
        render();
      } catch (err) {
        toast.error(err.message);
      }
    };

    const removeRoom = async (room) => {
      const ok = await confirmDialog({
        title: '删除房间',
        message: `将删除「${room.name}」及其全部消息，确定吗？`,
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
      try {
        await AdminAPI.deleteChatRoom(room.slug);
        toast.success('已删除');
        render();
      } catch (err) {
        toast.error(err.message);
      }
    };

    let qTimer = null;
    q.addEventListener('input', () => {
      clearTimeout(qTimer);
      qTimer = setTimeout(loadMessages, 260);
    });
    roomSel.addEventListener('change', loadMessages);

    clear(panel);
    panel.append(
      el('div.col', { style: { gap: '20px' } }, [
        el('div.row.wrap.gap-2', {}, [
          statCard('房间', rooms.length),
          statCard('消息总数', data.messages ?? 0),
          statCard('今日消息', data.messagesToday ?? 0),
          statCard('表情回应', data.reactions ?? 0),
          statCard('禁言中', mutes.length),
        ]),
        el('div.card', {}, [
          el('div.card-title', {}, '房间管理'),
          el('div.row.wrap.gap-2', { style: { marginBottom: '12px' } }, [
            el('button.btn.btn-primary.btn-sm', {
              type: 'button',
              onclick: async () => {
                const values = await formDialog({
                  title: '新建房间',
                  fields: [
                    { name: 'name', label: '房间名称', required: true, maxlength: 24 },
                    { name: 'topic', label: '房间主题', maxlength: 80 },
                  ],
                  submitText: '创建',
                });
                if (!values) return;
                try {
                  await AdminAPI.createChatRoom(values);
                  toast.success('已创建');
                  render();
                } catch (err) {
                  toast.error(err.message);
                }
              },
            }, '新建房间'),
            el('a.btn.btn-ghost.btn-sm', { href: '#/chat' }, '打开聊天室'),
          ]),
          el('div.chat-admin-grid', {}, roomRows),
        ]),
        el('div.card', {}, [
          el('div.card-title', {}, '消息检索'),
          el('div.row.wrap.gap-2', { style: { marginBottom: '12px' } }, [q, roomSel]),
          resultHint,
          listNode,
        ]),
        el('div.card', {}, [
          el('div.card-title', {}, '禁言管理'),
          mutesNode,
        ]),
      ]),
    );
    loadMessages();
  }

  /* ---------------- 用户 ---------------- */
  async function renderUsers() {
    const data = await AdminAPI.overview();
    clear(panel);
    panel.append(
      el('div.card', {}, [
        el('div.card-title', {}, `用户管理 · 共 ${data.stats.users} 人`),
        el('div.table-wrap', {}, [
          el('table', {}, [
            el('thead', {}, el('tr', {}, [el('th', {}, '用户'), el('th', {}, '邮箱'), el('th', {}, '角色'), el('th', {}, '文章'), el('th', {}, '注册/登录'), el('th', {}, '操作')])),
            el('tbody', {}, data.users.map((u) =>
              el('tr', {}, [
                el('td', {}, el('div.row', {}, [
                  avatar(u, 'sm'),
                  el('a', { href: `#/u/${u.username}`, style: { color: 'var(--text)' } }, u.username),
                ])),
                el('td.small.muted', {}, u.email),
                el('td', {}, badge(u.role === 'admin' ? '管理员' : u.role === 'moderator' ? '版主' : '用户', u.role === 'admin' ? 'danger' : '')),
                el('td', {}, String(u.post_count)),
                el('td.small.muted', {}, `${dateShort(u.created_at)} / ${u.last_login ? timeAgo(u.last_login) : '从未'}`),
                el('td', {}, el('div.row', { style: { gap: '4px' } }, [
                  el('button.btn.btn-ghost.btn-sm', {
                    type: 'button',
                    onclick: async () => {
                      const next = u.role === 'admin' ? 'user' : 'admin';
                      if (!(await confirmDialog({
                        title: '调整角色',
                        message: `将 ${u.username} 的角色改为「${next === 'admin' ? '管理员' : '普通用户'}」？`,
                        danger: next === 'user',
                      }))) return;
                      try {
                        await AdminAPI.setRole(u.id, next);
                        toast.success('已更新');
                        render();
                      } catch (err) {
                        toast.error(err.message);
                      }
                    },
                  }, u.role === 'admin' ? '降级' : '升级'),
                  el('button.icon-btn', {
                    type: 'button',
                    title: '删除用户',
                    onclick: async () => {
                      if (!(await confirmDialog({
                        title: '删除用户',
                        message: `删除 ${u.username} 将同时删除其全部文章、笔记、待办与书签，且不可恢复。`,
                        confirmText: '永久删除',
                        danger: true,
                      }))) return;
                      try {
                        await AdminAPI.removeUser(u.id);
                        toast.success('用户已删除');
                        render();
                      } catch (err) {
                        toast.error(err.message);
                      }
                    },
                  }, '🗑'),
                ])),
              ]),
            )),
          ]),
        ]),
      ]),
    );
  }

  /* ---------------- 短链 ---------------- */
  async function renderLinks() {
    const data = await AdminAPI.overview();
    clear(panel);
    panel.append(
      el('div.card', {}, [
        el('div.card-title', {}, `短链管理 · 共 ${data.shorts.length} 条`),
        el('div.table-wrap', {}, [
          el('table', {}, [
            el('thead', {}, el('tr', {}, [el('th', {}, '短码'), el('th', {}, '目标'), el('th', {}, '点击'), el('th', {}, '状态'), el('th', {}, '创建'), el('th', {}, '操作')])),
            el('tbody', {}, data.shorts.map((s) =>
              el('tr', {}, [
                el('td', {}, el('a.mono', { href: `/${s.code}`, target: '_blank' }, `/${s.code}`)),
                el('td', {}, el('span.truncate', { style: { display: 'block', maxWidth: '280px' } }, s.target)),
                el('td', {}, String(s.clicks)),
                el('td', {}, badge(s.active ? '启用' : '停用', s.active ? 'success' : 'warning')),
                el('td.small.muted', {}, dateShort(s.created_at)),
                el('td', {}, el('button.icon-btn', {
                  type: 'button',
                  title: '删除',
                  onclick: async () => {
                    if (!(await confirmDialog({ title: '删除短链', message: `确定删除 /${s.code}？`, confirmText: '删除', danger: true }))) return;
                    try {
                      await (await import('../lib/api.js')).ShortAPI.remove(s.id);
                      toast.success('已删除');
                      render();
                    } catch (err) {
                      toast.error(err.message);
                    }
                  },
                }, '🗑')),
              ]),
            )),
          ]),
        ]),
      ]),
    );
  }

  /* ---------------- 订阅 ---------------- */
  async function renderSubscribers() {
    const data = await AdminAPI.overview();
    clear(panel);
    panel.append(
      el('div.card', {}, [
        el('div.card-title', {}, `订阅列表 · 共 ${data.subscribers.length} 条`),
        data.subscribers.length
          ? el('div.table-wrap', {}, [
              el('table', {}, [
                el('thead', {}, el('tr', {}, [el('th', {}, '邮箱'), el('th', {}, '来源'), el('th', {}, '状态'), el('th', {}, '订阅时间')])),
                el('tbody', {}, data.subscribers.map((s) =>
                  el('tr', {}, [
                    el('td', {}, s.email),
                    el('td', {}, badge(s.source || 'site')),
                    el('td', {}, badge(s.status === 'pending' ? '待确认' : s.status, s.status === 'pending' ? 'warning' : 'success')),
                    el('td.small.muted', {}, dateShort(s.created_at)),
                  ]),
                )),
              ]),
            ])
          : empty('还没有订阅用户', '', null, '✉️'),
      ]),
    );
  }

  /* ---------------- 站点设置 ---------------- */
  async function renderSettings() {
    const data = await AdminAPI.overview();
    const s = data.settings;
    const fields = [
      { key: 'site_name', label: '站点名称' },
      { key: 'site_tagline', label: '站点标语' },
      { key: 'site_description', label: '站点描述（首页与 SEO）' },
      { key: 'footer_text', label: '页脚文字' },
      { key: 'icp', label: '备案号' },
    ];
    const inputs = new Map();
    const form = el('form', { onsubmit: (e) => e.preventDefault() });
    for (const f of fields) {
      const input = el(f.key === 'site_description' ? 'textarea.textarea' : 'input.input', {
        rows: 3,
        value: s[f.key] || '',
        placeholder: `请输入${f.label}`,
      });
      if (f.key !== 'site_description') input.value = s[f.key] || '';
      inputs.set(f.key, input);
      form.append(el('div.field', {}, [el('label', {}, f.label), input]));
    }
    const allowReg = el('input', { type: 'checkbox' });
    allowReg.checked = s.allow_registration !== false;
    form.append(el('label.switch', { style: { marginBottom: '16px' } }, [allowReg, el('span.track'), el('span.small', {}, '允许新用户注册')]));

    const saveBtn = el('button.btn.btn-primary', { type: 'button' }, '保存设置');
    saveBtn.addEventListener('click', async () => {
      saveBtn.setAttribute('aria-busy', 'true');
      const payload = { allow_registration: allowReg.checked };
      for (const [key, input] of inputs) payload[key] = input.value.trim();
      try {
        await AdminAPI.saveSettings(payload);
        toast.success('设置已保存，刷新后生效');
        const { hydrate } = await import('../lib/store.js');
        await hydrate();
        location.reload();
      } catch (err) {
        toast.error(err.message);
        saveBtn.removeAttribute('aria-busy');
      }
    });
    form.append(saveBtn);

    clear(panel);
    panel.append(el('div.card', {}, [el('div.card-title', {}, '站点设置'), form]));
  }

  /* ---------------- 维护 ---------------- */
  /* ---------- 积分商城 ---------- */
  async function renderShop() {
    const { economy, shop, items } = await AdminAPI.points();
    clear(panel);

    panel.append(
      el('div.stat-grid', { style: { marginBottom: '20px' } }, [
        statCard({ label: '流通积分', value: economy.totalPoints, icon: '🪙', hint: `${economy.holders} 人持有` }),
        statCard({ label: '今日产出', value: economy.todayEarned, icon: '📈', hint: `${economy.todayCheckins} 人签到` }),
        statCard({ label: '累计消费', value: economy.spent, icon: '🛒', hint: `${economy.redeems} 次兑换` }),
        statCard({ label: '在售道具', value: shop.active, icon: '🎁', hint: `共 ${shop.items} 件` }),
      ]),

      el('div.card', {}, [
        el('div.row-between.wrap', {}, [
          el('div.card-title', { style: { margin: '0' } }, '🎁 道具管理'),
          el('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => openItemDialog() }, '+ 新增道具'),
        ]),
        el('div.table-wrap', { style: { marginTop: '14px' } }, [
          el('table.table', {}, [
            el('thead', {}, el('tr', {}, ['道具', '类型', '价格', '库存', '已兑', '状态', '操作'].map((h) => el('th', {}, h)))),
            el('tbody', {}, items.map((item) => el('tr', {}, [
              el('td', {}, [el('span', { style: { marginRight: '6px' } }, item.icon), item.name]),
              el('td', {}, el('span.badge', { class: `badge-${toneOf(item.kind)}` }, item.kindLabel)),
              el('td', {}, numberFmt(item.price)),
              el('td', {}, item.stock < 0 ? '∞' : numberFmt(item.stock)),
              el('td', {}, numberFmt(item.sold)),
              el('td', {}, item.active
                ? el('span.badge.badge-success', {}, '在售')
                : el('span.badge.badge-muted', {}, '已下架')),
              el('td', {}, el('div.row', { style: { gap: '6px' } }, [
                el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => openItemDialog(item) }, '编辑'),
                el('button.btn.btn-ghost.btn-sm', {
                  type: 'button',
                  onclick: async () => {
                    try {
                      await AdminAPI.updateShopItem(item.id, { active: !item.active });
                      toast.success(item.active ? '已下架' : '已上架');
                      render();
                    } catch (err) {
                      toast.error(err.message);
                    }
                  },
                }, item.active ? '下架' : '上架'),
              ])),
            ]))),
          ]),
        ]),
      ]),
    );

    function toneOf(kind) {
      return { theme: 'indigo', frame: 'amber', badge: 'purple', storage: 'green', rename: 'blue' }[kind] || 'muted';
    }

    function openItemDialog(item = null) {
      const dlg = modal({
        title: item ? `编辑「${item.name}」` : '新增道具',
        body: el('div.col', { style: { gap: '12px' } }, [
          el('div.field', {}, [el('label', {}, '名称'), el('input.input', { value: item?.name || '', id: 'it-name' })]),
          el('div.field', {}, [el('label', {}, '描述'), el('input.input', { value: item?.description || '', id: 'it-desc' })]),
          el('div.grid.grid-2', { style: { gap: '12px' } }, [
            el('div.field', {}, [el('label', {}, '图标'), el('input.input', { value: item?.icon || '🎁', id: 'it-icon', maxlength: '4' })]),
            el('div.field', {}, [el('label', {}, '价格'), el('input.input', { type: 'number', min: '1', value: item?.price ?? 100, id: 'it-price' })]),
          ]),
          el('div.grid.grid-2', { style: { gap: '12px' } }, [
            el('div.field', {}, [
              el('label', {}, '类型'),
              el('select.input', { id: 'it-kind' }, Object.entries({
                theme: '主题皮肤', frame: '头像框', badge: '勋章', storage: '存储扩容', rename: '改名券',
              }).map(([k, v]) => el('option', { value: k, selected: item?.kind === k }, v))),
            ]),
            el('div.field', {}, [el('label', {}, '库存 (-1 不限)'), el('input.input', { type: 'number', min: '-1', value: item?.stock ?? -1, id: 'it-stock' })]),
          ]),
          el('div.field', {}, [
            el('label', {}, '生效值（JSON，可留空）'),
            el('input.input', { value: item?.payload ? JSON.stringify(item.payload) : '', id: 'it-payload', 'aria-label': '生效值', placeholder: '{"value":"ocean"}' }),
          ]),
        ]),
        footer: [
          el('button.btn.btn-ghost', { type: 'button', onclick: () => dlg.close() }, '取消'),
          el('button.btn.btn-primary', {
            type: 'button',
            onclick: async () => {
              const payloadRaw = document.getElementById('it-payload').value.trim();
              let payload = null;
              if (payloadRaw) {
                try {
                  payload = JSON.parse(payloadRaw);
                } catch {
                  toast.error('生效值不是合法 JSON');
                  return;
                }
              }
              const data = {
                name: document.getElementById('it-name').value.trim(),
                description: document.getElementById('it-desc').value.trim(),
                icon: document.getElementById('it-icon').value.trim() || '🎁',
                price: Number(document.getElementById('it-price').value),
                kind: document.getElementById('it-kind').value,
                stock: Number(document.getElementById('it-stock').value),
                payload,
              };
              if (!data.name || !data.price) return toast.error('名称与价格必填');
              try {
                if (item) await AdminAPI.updateShopItem(item.id, data);
                else await AdminAPI.createShopItem(data);
                toast.success(item ? '已保存' : '道具已创建');
                dlg.close();
                render();
              } catch (err) {
                toast.error(err.message);
              }
            },
          }, '保存'),
        ],
      });
    }
  }

  async function renderMaintenance() {
    const [db, events] = await Promise.all([AdminAPI.database(), AdminAPI.events()]);
    clear(panel);
    panel.append(
      el('div.card', {}, [
        el('div.card-title', {}, '🗄 数据库表统计'),
        el('div.table-wrap', {}, [
          el('table', {}, [
            el('thead', {}, el('tr', {}, [el('th', {}, '表名'), el('th', {}, '行数')])),
            el('tbody', {}, db.tables.map((t) =>
              el('tr', {}, [el('td.mono', {}, t.name), el('td', {}, numberFmt(t.rows))]),
            )),
          ]),
        ]),
      ]),
      el('div.grid.grid-2', { style: { marginTop: '20px' } }, [
        el('div.card', {}, [
          el('div.card-title', {}, '🧹 维护操作'),
          el('div.col', { style: { gap: '10px' } }, [
            el('div.row-between.wrap', {}, [
              el('div', {}, [
                el('strong', {}, '整理数据库'),
                el('p.small.muted', {}, '执行 VACUUM 并清理 90 天前的事件记录'),
              ]),
              el('button.btn.btn-ghost', {
                type: 'button',
                onclick: async () => {
                  if (!(await confirmDialog({ title: '整理数据库', message: '将回收空间并删除 90 天前的事件日志，可能短暂占用 CPU。', confirmText: '开始' }))) return;
                  try {
                    await AdminAPI.vacuum();
                    toast.success('整理完成');
                    render();
                  } catch (err) {
                    toast.error(err.message);
                  }
                },
              }, '执行'),
            ]),
            el('div.row-between.wrap', {}, [
              el('div', {}, [
                el('strong', {}, '清空聊天室'),
                el('p.small.muted', {}, '删除大厅中的所有聊天记录'),
              ]),
              el('button.btn.btn-outline-danger', {
                type: 'button',
                onclick: async () => {
                  if (!(await confirmDialog({ title: '清空聊天室', message: '所有聊天消息将被永久删除。', confirmText: '清空', danger: true }))) return;
                  try {
                    await AdminAPI.clearChat();
                    toast.success('聊天室已清空');
                  } catch (err) {
                    toast.error(err.message);
                  }
                },
              }, '清空'),
            ]),
          ]),
        ]),
        el('div.card', {}, [
          el('div.card-title', {}, '📡 最近事件'),
          el('div.list', { style: { maxHeight: '280px', overflowY: 'auto' } },
            events.recent.map((e) =>
              el('div.list-item', {}, [
                badge(e.type),
                el('span.small.muted.truncate.grow', {}, e.meta || e.target || ''),
                el('span.small.muted.nowrap', {}, timeAgo(e.created_at)),
              ]),
            ),
          ),
        ]),
      ]),
    );
  }

  await render();
}
