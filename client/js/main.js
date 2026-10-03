import { $, $$, formData, debounce } from './lib/dom.js';
import { api, fetchFragment } from './lib/api.js';
import { fromNow } from './lib/format.js';
import { refreshView } from './lib/view.js';
import { toast, toastOk, toastErr } from './ui/toast.js';
import { openModal, closeModal, confirmModal } from './ui/modal.js';
import { openPalette, installPalette } from './ui/palette.js';
import { noteModal, todoModal, linkModal, uploadModal, shortModal, newRoomModal, newDmModal, inviteModal, roomSettingsModal, bindCurrentUser } from './ui/forms.js';
import { createChat } from './ui/chat.js';

const state = readState();
const main = () => document.getElementById('main');

function readState() {
  try {
    return JSON.parse(document.getElementById('hub-state')?.textContent ?? '{}');
  } catch {
    return {};
  }
}

/* --------------------------------- 导航 --------------------------------- */

/** 站内链接交给 History API：向服务端要片段再替换内容区。 */
async function navigate(href, { replace = false, push = true } = {}) {
  const url = new URL(href, location.origin);
  if (url.origin !== location.origin) {
    location.assign(href);
    return;
  }

  const host = main();
  if (host) host.classList.add('is-busy');

  try {
    const html = await fetchFragment(url.pathname + url.search);
    if (host && html.trim()) {
      // 片段是若干并列顶层元素，整体搬入；#main 只作为外壳保留
      const holder = document.createElement('div');
      holder.innerHTML = html;
      host.replaceChildren(...holder.childNodes);
      host.classList.add('fade-in');
    }
    if (push) {
      if (replace) history.replaceState({}, '', url);
      else history.pushState({}, '', url);
    }
    markActiveNav(url.pathname);
    bindCurrentUser(state.user?.id ?? null);
    bindAfterSwap();
    maybeAutoOpen(url);
    document.body.classList.remove('nav-open');
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (error) {
    toastErr(error.message || '页面加载失败');
    if (push) location.assign(href);
  } finally {
    main()?.classList.remove('is-busy');
  }
}

function markActiveNav(pathname) {
  for (const link of $$('.nav-link')) {
    const isActive = link.getAttribute('href') === pathname || pathname.startsWith(`${link.getAttribute('href')}/`);
    const exact = link.getAttribute('href') === pathname;
    link.classList.toggle('is-active', exact || (isActive && link.getAttribute('href') !== '/'));
    if (exact) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const label = $('.page-heading')?.textContent?.trim() || $('.page-title')?.textContent?.trim();
  if (label) document.title = `${label} · ${document.body.dataset.siteName || 'Hub 超级中心'}`;
}

/** 支持 ?new=1 / ?upload=1 这类「带意图进入」的链接。 */
function maybeAutoOpen(url) {
  if (url.searchParams.get('new') === '1') {
    if (url.pathname === '/notes') noteModal();
    else if (url.pathname === '/todos') todoModal();
    else if (url.pathname === '/links') linkModal();
  }
  if (url.searchParams.get('upload') === '1' && url.pathname === '/files') {
    uploadModal(() => navigate('/files', { push: false }));
  }
  const editId = url.searchParams.get('edit');
  if (editId && url.pathname === '/notes') {
    api.notes
      .list()
      .then(({ items }) => {
        const found = items.find((item) => String(item.id) === editId);
        if (found) noteModal(found);
        else toastErr('笔记不存在');
      })
      .catch((error) => toastErr(error.message));
  }
}

/* -------------------------------- 交互绑定 -------------------------------- */

const ACTIONS = {
  'quick-add': () => quickAdd(),
  'new-note': () => noteModal(),
  'new-todo': () => todoModal(),
  'new-link': () => linkModal(),
  'pick-file': () => uploadModal(() => navigate(location.pathname + location.search, { push: false })),
  'edit-note': (node) => noteModal({ id: node.dataset.id }),
  'delete-note': async (node) => {
    const ok = await confirmModal({ title: '删除笔记', message: '删除后无法恢复，确定继续？', confirmText: '删除' });
    if (!ok) return;
    try {
      await api.notes.remove(node.dataset.id);
      toastOk('已删除');
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  'edit-link': async (node) => {
    try {
      const { items } = await api.links.list();
      const found = items.find((item) => String(item.id) === node.dataset.id);
      if (found) linkModal(found);
    } catch (error) {
      toastErr(error.message);
    }
  },
  'star-link': async (node) => {
    try {
      const { items } = await api.links.list();
      const found = items.find((item) => String(item.id) === node.dataset.id);
      if (!found) return;
      await api.links.update(found.id, { starred: !found.starred });
      navigate(location.pathname + location.search, { push: false });
    } catch (error) {
      toastErr(error.message);
    }
  },
  'delete-link': async (node) => {
    const ok = await confirmModal({ title: '删除书签', message: '确定删除这个书签？', confirmText: '删除' });
    if (!ok) return;
    try {
      await api.links.remove(node.dataset.id);
      toastOk('已删除');
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  'delete-file': async (node) => {
    const ok = await confirmModal({ title: '删除文件', message: '文件将从磁盘移除，无法恢复。', confirmText: '删除' });
    if (!ok) return;
    try {
      await api.files.remove(node.dataset.id);
      toastOk('文件已删除');
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  'clear-completed': async () => {
    try {
      const result = await api.todos.clearCompleted();
      toastOk(`已清理 ${result.removed} 项`);
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  'new-short': () => shortModal(),
  'switch-room': (node) => {
    const code = node.dataset.room;
    if (code === chatRoom()) return;
    chatClient?.join(code);
    navigate(`/chat?room=${encodeURIComponent(code)}`);
  },
  'join-room': async (node) => {
    try {
      await api.rooms.join(node.dataset.room);
      chatClient?.join(node.dataset.room);
      toastOk('已加入房间');
      await navigate(`/chat?room=${encodeURIComponent(node.dataset.room)}`);
    } catch (error) {
      toastErr(error.message);
    }
  },
  'new-room': () => newRoomModal(),
  'new-dm': () => newDmModal(),
  'send-file': () => chatClient?.pickFile(),
  'reply-to': (node) => {
    const message = { id: Number(node.dataset.id), nickname: node.dataset.nick, body: node.dataset.body };
    chatClient?.setReplyTarget(message);
    const bar = $('[data-reply-bar]');
    if (!bar) return;
    bar.hidden = false;
    bar.querySelector('[name="replyTo"]').value = String(message.id);
    bar.querySelector('[data-reply-nick]').textContent = message.nickname;
    bar.querySelector('[name="body"]').focus();
  },
  'cancel-reply': () => {
    chatClient?.setReplyTarget(null);
    const bar = $('[data-reply-bar]');
    if (!bar) return;
    bar.hidden = true;
    bar.querySelector('[name="replyTo"]').value = '';
    bar.querySelector('[name="body"]').value = '';
    $('.chat-input input[name="body"]')?.focus();
  },
  'pin-message': async (node) => {
    try {
      await api.rooms.pin(node.dataset.room, Number(node.dataset.id));
      toastOk('已设为群公告');
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  unpin: async (node) => {
    try {
      await api.rooms.unpin(node.dataset.room);
      toastOk('已取消置顶');
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  'toggle-mute': async (node) => {
    const button = node;
    const muted = button.classList.contains('is-on');
    try {
      await api.rooms.mute(node.dataset.room, !muted);
      toastOk(!muted ? '已开启免打扰' : '已关闭免打扰');
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  'open-search': () => {
    const form = $('[data-chat-search]');
    if (!form) return;
    form.hidden = false;
    form.querySelector('input').focus();
  },
  'close-search': () => {
    const form = $('[data-chat-search]');
    const results = $('[data-chat-search-results]');
    if (form) form.hidden = true;
    if (results) {
      results.hidden = true;
      results.replaceChildren();
    }
  },
  'load-older': async (node) => {
    node.disabled = true;
    node.textContent = '加载中…';
    try {
      const more = await chatClient?.loadOlder();
      if (!more) {
        node.remove();
      } else {
        node.disabled = false;
        node.textContent = '加载更早的消息';
      }
    } catch {
      node.disabled = false;
      node.textContent = '加载更早的消息';
    }
  },
  'toggle-members': () => {
    const panel = $('[data-members-panel]');
    if (!panel) return;
    panel.classList.toggle('is-open');
  },
  'invite-member': (node) => inviteModal(node.dataset.room),
  'kick-member': async (node) => {
    const ok = await confirmModal({ title: '移出成员', message: '确定把该成员移出房间？', confirmText: '移出' });
    if (!ok) return;
    try {
      await api.rooms.kick(node.dataset.room, Number(node.dataset.id));
      toastOk('已移出');
      await refreshMembers();
    } catch (error) {
      toastErr(error.message);
    }
  },
  'leave-room': async (node) => {
    const ok = await confirmModal({ title: '退出群聊', message: '退出后将无法再查看该群消息。', confirmText: '退出' });
    if (!ok) return;
    try {
      await api.rooms.leave(node.dataset.room);
      chatClient?.send({ type: 'leave', room: node.dataset.room });
      toastOk('已退出');
      await navigate('/chat');
    } catch (error) {
      toastErr(error.message);
    }
  },
  'delete-room': async (node) => {
    const ok = await confirmModal({ title: '解散群聊', message: '房间将被删除，消息不再保留。', confirmText: '解散' });
    if (!ok) return;
    try {
      await api.rooms.remove(node.dataset.room);
      chatClient?.send({ type: 'leave', room: node.dataset.room });
      toastOk('群聊已解散');
      await navigate('/chat');
    } catch (error) {
      toastErr(error.message);
    }
  },
  'room-settings': (node) => roomSettingsModal(node.dataset.room),
  'redeem-and-equip': (node) => redeem(node),
  'delete-post': async (node) => {
    const ok = await confirmModal({ title: '删除文章', message: '文章与全部评论都会删除，无法恢复。', confirmText: '删除' });
    if (!ok) return;
    try {
      await api.blog.remove(node.dataset.id);
      toastOk('文章已删除');
      navigate('/blog', { push: false });
    } catch (error) {
      toastErr(error.message);
    }
  },
  'like-post': async (node) => {
    if (!state.user) return requireLogin();
    try {
      const result = await api.blog.like(node.dataset.id);
      node.classList.toggle('is-liked', result.liked);
      const counter = node.querySelector('[data-like-count]');
      if (counter) counter.textContent = result.count;
      toast(result.liked ? '已点赞，作者 +1 积分' : '已取消点赞', 'ok', 1600);
    } catch (error) {
      toastErr(error.message);
    }
  },
  'bookmark-post': async (node) => {
    if (!state.user) return requireLogin();
    try {
      const result = await api.blog.bookmark(node.dataset.id);
      node.classList.toggle('is-liked', result.bookmarked);
      node.childNodes[0].nodeValue = result.bookmarked ? '已收藏 ' : '收藏 ';
      toast(result.bookmarked ? '已加入收藏' : '已移出收藏', 'ok', 1600);
    } catch (error) {
      toastErr(error.message);
    }
  },
  'like-comment': async (node) => {
    if (!state.user) return requireLogin();
    try {
      const result = await api.blog.likeComment(node.dataset.id);
      const counter = node.querySelector('span');
      if (counter) counter.textContent = result.count;
      node.classList.toggle('is-liked', result.liked);
    } catch (error) {
      toastErr(error.message);
    }
  },
  'copy-short': async (node) => {
    const link = `${location.origin}/s/${node.dataset.code}`;
    await copyText(link);
    toastOk(`已复制 ${link}`);
  },
  'copy-link': async () => {
    await copyText(location.href);
    toastOk('链接已复制');
  },
  'toggle-short': async (node) => {
    try {
      await api.shorts.toggle(node.dataset.id, node.dataset.active !== '1');
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  'delete-short': async (node) => {
    const ok = await confirmModal({ title: '删除短链', message: '删除后该短码立即失效。', confirmText: '删除' });
    if (!ok) return;
    try {
      await api.shorts.remove(node.dataset.id);
      toastOk('短链已删除');
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  checkin: async (node) => {
    try {
      const result = await api.points.checkin();
      if (result.already) {
        toast(`今天已经签过啦，当前连签 ${result.streak} 天`, 'info');
        return;
      }
      toastOk(`签到成功 +${result.reward} 积分，连签 ${result.streak} 天`);
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  redeem: async (node) => {
    try {
      const result = await api.points.redeem(node.dataset.id);
      toastOk(`兑换成功：${result.item.name}`);
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  'use-item': async (node) => {
    const ok = await confirmModal({
      title: '使用道具',
      message: '确定要使用这个道具吗？改名券使用后可在设置里修改用户名。',
      confirmText: '使用',
      danger: false,
    });
    if (!ok) return;
    try {
      const result = await api.points.use(node.dataset.id);
      toastOk(`已使用：${result.item.name}`);
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  'toggle-theme': () => toggleTheme(),
  'toggle-nav': () => document.body.classList.toggle('nav-open'),
  'open-search': () => openPalette(),
  logout: async () => {
    try {
      await api.auth.logout();
    } finally {
      location.assign('/login');
    }
  },
  'kill-session': async (node) => {
    try {
      await api.auth.killSession(node.dataset.id);
      toastOk('已下线该设备');
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  'toggle-role': async (node) => {
    const next = node.dataset.role === 'admin' ? 'user' : 'admin';
    const ok = await confirmModal({
      title: '调整角色',
      message: `确定将该用户设为${next === 'admin' ? '管理员' : '普通用户'}？`,
      confirmText: '确定',
      danger: false,
    });
    if (!ok) return;
    try {
      await api.admin.setRole(node.dataset.id, next);
      toastOk('角色已更新');
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
  'delete-user': async (node) => {
    const ok = await confirmModal({ title: '删除用户', message: '该用户及其全部数据都会被删除。', confirmText: '删除' });
    if (!ok) return;
    try {
      await api.admin.removeUser(node.dataset.id);
      toastOk('用户已删除');
      await refreshView();
    } catch (error) {
      toastErr(error.message);
    }
  },
};

function quickAdd() {
  const path = location.pathname;
  if (path.startsWith('/notes')) noteModal();
  else if (path.startsWith('/todos')) todoModal();
  else if (path.startsWith('/links')) linkModal();
  else if (path.startsWith('/files')) uploadModal(() => navigate('/files', { push: false }));
  else if (path.startsWith('/short')) shortModal();
  else if (path.startsWith('/blog/new') || path.startsWith('/blog/') && path.endsWith('/edit')) location.assign('/blog/new');
  else quickAddModal();
}

const requireLogin = () => {
  toastErr('请先登录');
  setTimeout(() => location.assign(`/login?next=${encodeURIComponent(location.pathname)}`), 800);
};

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 非安全上下文下 clipboard 不可用，退回选中复制
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function quickAddModal() {
  openModal({
    title: '快速新建',
    width: 420,
    build: ({ close, body, foot }) => {
      const list = el('div', { class: 'form' }, [
        option('新建笔记', '记录一条想法或资料', () => noteModal()),
        option('新建待办', '添加一件要做的事', () => todoModal()),
        option('新建书签', '收藏一个网址', () => linkModal()),
        option('上传文件', '把文件放进 Hub', () => uploadModal(() => navigate('/files', { push: false }))),
        option('创建短链', '把长链接变短', () => shortModal()),
        option('写文章', 'Markdown 写作', () => location.assign('/blog/new')),
      ]);
      function option(title, hint, run) {
        return el(
          'button',
          {
            class: 'btn btn-block',
            type: 'button',
            style: 'justify-content:space-between;text-align:left',
            onClick: () => {
              close();
              run();
            },
          },
          [el('span', {}, [title]), el('span', { class: 'hint' }, [hint])],
        );
      }
      body.append(list);
      foot.append(el('button', { class: 'btn', type: 'button', onClick: () => close(false) }, ['关闭']));
      return { footer: true };
    },
  });
}

/* --------------------------------- 主题 --------------------------------- */

const THEMES = ['light', 'dark', 'auto'];

function applyTheme(theme) {
  const resolved = theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = theme;
  try {
    localStorage.setItem('hub.theme', theme);
  } catch {
    /* 隐私模式下忽略 */
  }
  if (state.user) {
    document.documentElement.dataset.accent = state.user.accent;
  }
}

function toggleTheme() {
  const current = document.documentElement.dataset.themePref ?? 'auto';
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  applyTheme(next);
  toast(`主题：${{ light: '浅色', dark: '深色', auto: '跟随系统' }[next]}`, 'info', 1600);
  if (state.user && next !== state.user.theme) {
    api.auth.updateProfile({ theme: next }).then(({ user }) => {
      state.user = user;
    }).catch(() => {});
  }
}

/* -------------------------------- 表单处理 -------------------------------- */

/** 只接受站内相对路径，避免 ?next= 变成开放重定向。 */
function safeNext() {
  const next = new URLSearchParams(location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

const FORMS = {
  login: async (values) => {
    await api.auth.login(values);
    location.assign(safeNext());
  },
  register: async (values, form) => {
    if (values.password !== values.confirm) throw new Error('两次输入的密码不一致');
    await api.auth.register({ email: values.email, username: values.username, password: values.password });
    toastOk('注册成功');
    location.assign('/');
  },
  profile: async (values) => {
    const { user } = await api.auth.updateProfile(values);
    state.user = user;
    document.documentElement.dataset.accent = user.accent;
    toastOk('资料已保存');
    await refreshView();
  },
  password: async (values) => {
    await api.auth.changePassword({ current: values.current, next: values.next });
    toastOk('密码已更新');
    form.reset();
  },
  post: async (values, form) => {
    const status = form.querySelector('button[value]:focus')?.value ?? form.dataset.status ?? 'published';
    const payload = { ...values, coverHue: Number(values.coverHue ?? 220) };
    if (form.dataset.id) await api.blog.update(form.dataset.id, payload);
    else await api.blog.create(payload);
    toastOk('已保存');
    location.assign(form.dataset.id ? `/blog/${form.dataset.id}` : '/blog');
  },
  comment: async (values, form) => {
    const postId = form.dataset.post;
    const result = await api.blog.comment(postId, values);
    toastOk(result.pending ? '评论已提交，待管理员审核后展示' : '评论已发布');
    location.reload();
  },
  subscribe: async (values) => {
    const result = await api.subscribe(values.email);
    toastOk(result.existed ? '你已订阅过，邮箱保持有效' : '订阅成功，有更新会通知你');
  },
  site: async (values) => {
    await api.admin.updateSettings(values);
    toastOk('站点设置已保存');
    location.reload();
  },
};

function handleSubmit(form) {
  const handler = FORMS[form.dataset.form];
  if (!handler) return;
  const submit = form.querySelector('button[type="submit"]');
  const error = form.querySelector('.form-error') ?? createErrorSlot(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    // 编辑器的「发布 / 存草稿」靠提交按钮的 value 区分
    if (event.submitter?.value) form.dataset.status = event.submitter.value;
    if (submit) submit.disabled = true;
    error.hidden = true;
    try {
      await handler(formData(form), form);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      if (!$('[data-inline-host]')) toastErr(err.message);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

function createErrorSlot(form) {
  const node = document.createElement('p');
  node.className = 'form-error';
  node.hidden = true;
  form.append(node);
  return node;
}

/** 密码强度条：跟随输入实时请求评分。 */
function installPasswordMeter(root) {
  for (const input of $$('[data-password-meter]', root)) {
    if (input.dataset.meterBound) continue;
    input.dataset.meterBound = '1';
    const form = input.closest('form');
    const meter = form?.querySelector('[data-meter]');
    if (!meter) continue;
    const bar = meter.querySelector('.meter-bar');
    const label = meter.querySelector('span');
    const COLORS = ['var(--danger)', 'var(--danger)', 'var(--warn)', 'var(--ok)', 'var(--ok)'];

    const update = debounce(async (value) => {
      meter.hidden = false;
      if (!value) {
        bar.style.setProperty('--pct', '0%');
        label.textContent = '';
        return;
      }
      try {
        const score = await api.auth.passwordScore(value);
        bar.style.setProperty('--pct', `${(score.score / 4) * 100}%`);
        bar.style.setProperty('--meter-color', COLORS[score.score]);
        label.textContent = `${score.label}${score.hints?.length ? ` · ${score.hints[0]}` : ''}`;
      } catch {
        meter.hidden = true;
      }
    }, 220);

    input.addEventListener('input', () => update(input.value));
  }
}

/* ------------------------------- 事件委托 ------------------------------- */

function installGlobalListeners() {
  document.addEventListener('click', async (event) => {
    const actionNode = event.target.closest('[data-action]');
    if (actionNode) {
      event.preventDefault();
      const handler = ACTIONS[actionNode.dataset.action];
      if (handler) {
        try {
          await handler(actionNode);
        } catch (error) {
          toastErr(error.message || '操作失败');
        }
      }
      return;
    }

    const link = event.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || link.target === '_blank' || link.hasAttribute('download')) return;
    if (/^(https?:)?\/\//i.test(href) || href.startsWith('mailto:') || link.dataset.linkClick) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

    // 书签点击统计
    if (link.dataset.linkClick) {
      api.links.click(link.dataset.linkClick).catch(() => {});
      return;
    }

    event.preventDefault();
    navigate(href);
  });

  document.addEventListener('change', async (event) => {
    const toggle = event.target.closest('[data-todo-toggle]');
    if (toggle) {
      const id = toggle.dataset.todoToggle;
      try {
        await api.todos.update(id, { done: toggle.checked });
        const row = toggle.closest('li');
        row?.querySelector('.row-title')?.classList.toggle('is-done', toggle.checked);
      } catch (error) {
        toggle.checked = !toggle.checked;
        toastErr(error.message);
      }
      return;
    }

    if (event.target.matches('[data-theme-set]')) {
      const theme = event.target.dataset.themeSet;
      applyTheme(theme);
      for (const button of $$('[data-theme-set]')) {
        const on = button === event.target;
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-checked', String(on));
      }
      save({ theme });
    }

    if (event.target.matches('[data-accent-set]')) {
      const accent = event.target.dataset.accentSet;
      document.documentElement.dataset.accent = accent;
      for (const swatch of $$('[data-accent-set]')) {
        const on = swatch === event.target;
        swatch.classList.toggle('is-active', on);
        swatch.setAttribute('aria-checked', String(on));
      }
      save({ accent });
    }
  });

  document.addEventListener('input', (event) => {
    const filter = event.target.closest('[data-filter]');
    if (!filter) return;
    const url = new URL(location.href);
    const value = filter.value.trim();
    if (value) url.searchParams.set('q', value);
    else url.searchParams.delete('q');
    filterDebounced(url.pathname + url.search);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) {
      event.preventDefault();
      openPalette();
    }
    if (event.key === 'n' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      quickAdd();
    }
  });

  document.addEventListener('hub:toggle-theme', toggleTheme);

  window.addEventListener('popstate', () => navigate(location.href, { push: false }));
}

const filterDebounced = debounce((href) => navigate(href, { push: false }), 320);

async function save(payload) {
  try {
    const { user } = await api.auth.updateProfile(payload);
    state.user = user;
  } catch (error) {
    toastErr(error.message);
  }
}

/* ------------------------------ 文件拖拽上传 ------------------------------ */

let dragBound = false;

function installDragUpload() {
  if (!location.pathname.startsWith('/files') || dragBound) return;
  dragBound = true;
  let depth = 0;

  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  document.addEventListener('dragenter', (event) => {
    stop(event);
    depth += 1;
    document.body.classList.add('is-dropping');
  });
  document.addEventListener('dragover', stop);
  document.addEventListener('dragleave', (event) => {
    stop(event);
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('is-dropping');
  });
  document.addEventListener('drop', async (event) => {
    stop(event);
    depth = 0;
    document.body.classList.remove('is-dropping');
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;

    let uploaded = 0;
    for (const file of files) {
      const body = new FormData();
      body.append('file', file);
      try {
        await api.files.upload(body);
        uploaded += 1;
      } catch (error) {
        toastErr(`${file.name}：${error.message}`);
      }
    }
    if (uploaded) {
      toastOk(`已上传 ${uploaded} 个文件`);
      navigate('/files', { push: false });
    }
  });
}

/* --------------------------------- 启动 --------------------------------- */

let chatClient = null;
const chatRoom = () => $('#chat-log')?.dataset.room || 'lobby';

const searchDebounced = debounce(async (keyword) => {
  const results = $('[data-chat-search-results]');
  if (!results || !keyword.trim()) {
    if (results) results.replaceChildren();
    return;
  }
  try {
    const { items } = await chatClient.search(keyword.trim());
    results.replaceChildren();
    results.hidden = false;
    if (!items.length) {
      results.innerHTML = '<p class="hint chat-search-empty">没有匹配的消息</p>';
      return;
    }
    for (const message of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'chat-search-hit';
      row.innerHTML = `<strong></strong><em></em><span class="hint"></span>`;
      row.querySelector('strong').textContent = message.nickname;
      row.querySelector('em').textContent = message.body.slice(0, 120);
      row.querySelector('span').textContent = fromNow(message.createdAt);
      row.addEventListener('click', () => {
        const node = document.getElementById(`msg-${message.id}`);
        if (!node) return toast('这条消息不在当前已加载的范围内');
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        node.classList.add('is-flash');
        setTimeout(() => node.classList.remove('is-flash'), 1400);
      });
      results.append(row);
    }
  } catch (error) {
    results.hidden = false;
    results.innerHTML = '<p class="hint">搜索失败，请稍后重试</p>';
  }
}, 260);

/** 引用回复：走聊天自己的输入条。 */
function bindReplyBar() {
  const bar = $('[data-reply-bar]');
  if (!bar || bar.dataset.bound) return;
  bar.dataset.bound = '1';
  bar.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = bar.querySelector('[name="body"]');
    const target = chatClient?.getReplyTarget();
    if (!input.value.trim()) return;
    const sent = target
      ? chatClient?.send({ type: 'chat', body: input.value, replyTo: target.id })
      : chatClient?.sendText(input.value);
    if (sent) {
      input.value = '';
      bar.hidden = true;
      chatClient?.setReplyTarget(null);
    }
  });
}

/** 搜索用文档级事件委托：无论输入框何时被渲染出来都能响应，不依赖绑定时机。 */
let searchBound = false;
function bindChatSearch() {
  if (searchBound) return;
  searchBound = true;

  document.addEventListener('input', (event) => {
    const input = event.target.closest('[data-chat-search-input]');
    if (input) searchDebounced(input.value);
  });

  document.addEventListener('keydown', (event) => {
    const input = event.target.closest('[data-chat-search-input]');
    if (!input) return;
    if (event.key === 'Escape') {
      input.value = '';
      searchDebounced('');
      ACTIONS['close-search']();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      searchDebounced(input.value);
    }
  });
}

function bindAfterSwap() {
  for (const form of $$('[data-form]')) handleSubmit(form);
  bindReplyBar();
  bindChatSearch();
  installPasswordMeter(document);
  installEditor();
  installDragUpload();
  mountChat();
  maybeAutoOpen(new URL(location.href));
}

/** 编辑器：输入防抖后向服务端要渲染结果，保证预览与线上渲染完全一致。 */
function installEditor() {
  const form = $('[data-form="post"]');
  if (!form || form.dataset.previewBound) return;
  form.dataset.previewBound = '1';

  const body = form.querySelector('[name="body"]');
  const target = $('[data-preview]');
  if (!body || !target) return;

  const update = debounce(async (value) => {
    if (!value.trim()) {
      target.innerHTML = '<p class="hint">开始输入即可预览</p>';
      return;
    }
    try {
      const result = await api.preview(value);
      target.innerHTML = result.html;
    } catch {
      target.innerHTML = '<p class="hint">预览失败</p>';
    }
  }, 420);

  body.addEventListener('input', () => update(body.value));
  if (body.value.trim()) update(body.value);
}

function mountChat() {
  const log = $('#chat-log');
  if (!log) {
    chatClient?.close();
    chatClient = null;
    return;
  }
  // 换页后 DOM 是新的，必须重建连接
  chatClient?.close();
  chatClient = createChat({
    log,
    status: $('[data-chat-status]'),
    onRoomChange: (code, meta) => {
      if (meta?.members) refreshMembers();
      if (meta?.unread) markUnread(code);
    },
  });
}

/** 房间成员变动后刷新右侧成员面板。 */
async function refreshMembers() {
  const code = chatRoom();
  const list = $('[data-member-list]');
  if (!list || code === 'lobby') return;
  try {
    const { items } = await api.rooms.members(code);
    for (const node of [...list.children]) {
      const id = Number(node.dataset.member);
      const member = items.find((entry) => entry.id === id);
      if (!member) {
        node.remove();
        continue;
      }
      const title = node.querySelector('.row-title');
      if (title && member.title) title.innerHTML += ` <em class="badge">${member.title}</em>`;
    }
    for (const member of items) {
      if (list.querySelector(`[data-member="${member.id}"]`)) continue;
      list.insertAdjacentHTML(
        'beforeend',
        `<li class="row" data-member="${member.id}">
           <span class="avatar avatar-sm" style="--hue:${Number(member.avatarHue) || 210}">${(member.nickname || '?').slice(0, 1).toUpperCase()}</span>
           <span class="row-main"><span class="row-title"></span><span class="row-meta">@${member.username}</span></span>
         </li>`,
      );
      const title = list.querySelector(`[data-member="${member.id}"] .row-title`);
      if (title) title.textContent = member.nickname;
    }
  } catch {
    /* 成员刷新失败不打断聊天 */
  }
}

/** 收到非当前房间消息时给房间项加未读点。 */
function markUnread(code) {
  const item = document.querySelector(`[data-action="switch-room"][data-room="${CSS.escape(code)}"]`);
  if (!item || item.classList.contains('is-active')) return;
  item.classList.add('has-unread');
}

function boot() {
  bindCurrentUser(state.user?.id ?? null);
  installGlobalListeners();
  installPalette();
  bindAfterSwap();
  applyTheme(document.documentElement.dataset.themePref ?? localStorage.getItem('hub.theme') ?? 'auto');

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((document.documentElement.dataset.themePref ?? 'auto') === 'auto') applyTheme('auto');
  });

  // 快捷键：g + 字母 跳转到对应模块
  let pendingG = false;
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (event.key === 'g' || event.key === 'G') {
      pendingG = true;
      setTimeout(() => {
        pendingG = false;
      }, 800);
      return;
    }
    if (!pendingG) return;
    pendingG = false;
    const map = { d: '/', n: '/notes', t: '/todos', l: '/links', f: '/files', s: '/settings' };
    const target = map[event.key.toLowerCase()];
    if (target) {
      event.preventDefault();
      navigate(target);
    }
  });

  document.documentElement.dataset.ready = '1';
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();

export { navigate, state };
