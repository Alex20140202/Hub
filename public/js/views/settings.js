import { el, clear } from '../lib/dom.js';
import { store, applyTheme } from '../lib/store.js';
import { AuthAPI, api } from '../lib/api.js';
import { dateTime, timeAgo } from '../lib/format.js';
import { avatar, badge, tabs, input } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { go } from '../lib/router.js';

const THEMES = [
  { value: 'light', label: '☀ 亮色' },
  { value: 'dark', label: '☾ 暗色' },
  { value: 'system', label: '🖥 跟随系统' },
];

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export default async function settingsView(host) {
  const user = store.user;
  let current = 'profile';

  const panel = el('div');
  const tabBar = tabs(
    [
      { key: 'profile', label: '个人资料' },
      { key: 'security', label: '安全' },
      { key: 'appearance', label: '外观' },
      { key: 'account', label: '账号' },
    ],
    current,
    (key) => {
      current = key;
      render();
    },
  );

  host.append(
    el('div.page-head', {}, [
      el('h1', {}, '设置'),
      el('p', {}, '管理你的资料、密码与偏好'),
    ]),
    el('div.grid.grid-sidebar', {}, [
      el('div.card', { style: { padding: '0', overflow: 'hidden' } }, [
        el('div', { style: { padding: '0 16px', borderBottom: '1px solid var(--border)' } }, tabBar),
        el('div', { style: { padding: '22px' } }, panel),
      ]),
      el('div.col', { style: { gap: '16px' } }, [
        el('div.card', {}, [
          el('div.card-title', {}, '当前账号'),
          el('div.row', {}, [
            avatar(user, 'lg'),
            el('div', {}, [
              el('strong', {}, user.nickname || user.username),
              el('div.small.muted', {}, `@${user.username}`),
            ]),
          ]),
          el('div.list', { style: { marginTop: '12px' } }, [
            infoRow('邮箱', user.email),
            infoRow('角色', user.role === 'admin' ? '管理员' : user.role === 'moderator' ? '版主' : '成员'),
            infoRow('注册时间', dateTime(user.created_at)),
          ]),
        ]),
        el('div.card', {}, [
          el('div.card-title', {}, '快捷键'),
          el('div.col', { style: { gap: '6px', fontSize: '0.86rem' } }, [
            keyRow('⌘K / Ctrl+K', '打开命令面板'),
            keyRow('/', '快速搜索'),
            keyRow('⌘S', '编辑器内保存'),
            keyRow('N', '待办页新建'),
            keyRow('Esc', '关闭弹窗'),
          ]),
        ]),
      ]),
    ]),
  );

  function render() {
    clear(panel);
    if (current === 'profile') renderProfile();
    else if (current === 'security') renderSecurity();
    else if (current === 'appearance') renderAppearance();
    else renderAccount();
  }

  /* ---------------- 个人资料 ---------------- */
  function renderProfile() {
    const nickname = input({ value: user.nickname || '', placeholder: '昵称', maxlength: '24' });
    const bio = el('textarea.textarea', { rows: 4, placeholder: '介绍一下自己…', maxlength: '300' });
    bio.value = user.bio || '';
    const website = input({ value: user.website || '', placeholder: 'https://your-site.com' });
    const location = input({ value: user.location || '', placeholder: '所在城市' });
    const username = input({ value: user.username, placeholder: '用户名', maxlength: '24' });
    const email = input({ type: 'email', value: user.email });

    const colorRow = el('div.row.wrap', { style: { gap: '8px' } });
    let pickedColor = user.avatar_color || AVATAR_COLORS[0];
    const drawColors = () => {
      colorRow.replaceChildren();
      for (const c of AVATAR_COLORS) {
        const swatch = el('button', {
          type: 'button',
          'aria-label': `选择颜色 ${c}`,
          style: {
            width: '30px', height: '30px', borderRadius: '50%', background: c,
            border: pickedColor === c ? '3px solid var(--text)' : '2px solid var(--border)',
            transform: pickedColor === c ? 'scale(1.1)' : 'none',
          },
          onclick: () => {
            pickedColor = c;
            drawColors();
          },
        });
        colorRow.append(swatch);
      }
    };
    drawColors();

    const preview = el('div.row', { style: { marginBottom: '16px' } }, [
      el('div.avatar.lg', { style: { background: pickedColor } }, (user.nickname || user.username).slice(0, 2)),
      el('div', {}, [
        el('strong', {}, user.nickname || user.username),
        el('div.small.muted', {}, '头像颜色预览'),
      ]),
    ]);
    colorRow.addEventListener('click', () => {
      preview.firstElementChild.style.background = pickedColor;
    });

    const saveBtn = el('button.btn.btn-primary', { type: 'button' }, '保存修改');

    saveBtn.addEventListener('click', async () => {
      saveBtn.setAttribute('aria-busy', 'true');
      try {
        const { user: updated } = await AuthAPI.update({
          nickname: nickname.value.trim(),
          bio: bio.value.trim(),
          website: website.value.trim(),
          location: location.value.trim(),
          username: username.value.trim(),
          email: email.value.trim(),
          avatarColor: pickedColor,
        });
        Object.assign(store.user, updated);
        toast.success('资料已更新');
        render();
      } catch (err) {
        toast.error(err.message);
      } finally {
        saveBtn.removeAttribute('aria-busy');
      }
    });

    panel.append(
      el('div.card-title', {}, '个人资料'),
      preview,
      el('div.field', {}, [el('label', {}, '头像颜色'), colorRow]),
      el('div.grid.grid-2', { style: { gap: '12px' } }, [
        el('div.field', {}, [el('label', {}, '昵称'), nickname]),
        el('div.field', {}, [el('label', {}, '用户名'), username]),
      ]),
      el('div.field', {}, [el('label', {}, '个人简介'), bio]),
      el('div.grid.grid-2', { style: { gap: '12px' } }, [
        el('div.field', {}, [el('label', {}, '邮箱'), email]),
        el('div.field', {}, [el('label', {}, '所在地'), location]),
      ]),
      el('div.field', {}, [el('label', {}, '个人网站'), website]),
      el('div.row', {}, [saveBtn]),
    );
  }

  /* ---------------- 安全 ---------------- */
  function renderSecurity() {
    const currentPw = input({ type: 'password', placeholder: '当前密码', autocomplete: 'current-password' });
    const newPw = input({ type: 'password', placeholder: '新密码（至少 6 位）', autocomplete: 'new-password' });
    const confirmPw = input({ type: 'password', placeholder: '再输入一次', autocomplete: 'new-password' });
    const strength = el('div.strength', {}, [el('i'), el('i'), el('i'), el('i')]);
    const strengthText = el('div.hint', {}, '至少 6 位字符');

    newPw.addEventListener('input', async () => {
      const v = newPw.value;
      if (!v) {
        [...strength.children].forEach((b) => (b.className = ''));
        strengthText.textContent = '至少 6 位字符';
        return;
      }
      let score = 0;
      try {
        ({ score } = await AuthAPI.passwordScore(v));
      } catch {
        score = Math.min(4, Math.floor(v.length / 4));
      }
      strengthText.textContent = `强度：${['很弱', '较弱', '一般', '较强', '很强'][score]}`;
      [...strength.children].forEach((b, i) => (b.className = i < score ? `on-${score}` : ''));
    });

    const saveBtn = el('button.btn.btn-primary', { type: 'button' }, '修改密码');
    saveBtn.addEventListener('click', async () => {
      if (newPw.value.length < 6) return toast.warning('新密码至少 6 位');
      if (newPw.value !== confirmPw.value) return toast.warning('两次输入的新密码不一致');
      saveBtn.setAttribute('aria-busy', 'true');
      try {
        await AuthAPI.update({ currentPassword: currentPw.value, password: newPw.value });
        currentPw.value = newPw.value = confirmPw.value = '';
        toast.success('密码已修改');
      } catch (err) {
        toast.error(err.message);
      } finally {
        saveBtn.removeAttribute('aria-busy');
      }
    });

    panel.append(
      el('div.card-title', {}, '修改密码'),
      el('div.field', {}, [el('label', {}, '当前密码'), currentPw]),
      el('div.field', {}, [el('label', {}, '新密码'), newPw, strength, strengthText]),
      el('div.field', {}, [el('label', {}, '确认新密码'), confirmPw]),
      el('div.row', {}, [saveBtn]),
    );
  }

  /* ---------------- 外观 ---------------- */
  function renderAppearance() {
    const themeRow = el('div.row.wrap', { style: { gap: '8px' } });
    const drawThemes = () => {
      themeRow.replaceChildren();
      for (const t of THEMES) {
        const btn = el(`button.chip${store.theme === t.value ? '.active' : ''}`, { type: 'button' }, t.label);
        btn.addEventListener('click', async () => {
          applyTheme(t.value);
          drawThemes();
          try {
            await AuthAPI.update({ theme: t.value });
          } catch {
            /* 主题保存失败不阻塞 */
          }
        });
        themeRow.append(btn);
      }
    };
    drawThemes();

    const densityRow = el('div.col', { style: { gap: '8px' } }, [
      el('div.small.muted', {}, '界面尺寸由 CSS 变量 clamp() 自适应，无需手动设置。'),
    ]);

    panel.append(
      el('div.card-title', {}, '主题'),
      el('div.field', {}, [el('label', {}, '配色方案'), themeRow]),
      el('div.card-title', { style: { marginTop: '24px' } }, '显示'),
      densityRow,
      el('button.btn.btn-ghost', {
        type: 'button',
        style: { marginTop: '20px' },
        onclick: () => {
          localStorage.removeItem('hub.theme');
          location.reload();
        },
      }, '重置外观设置'),
    );
  }

  /* ---------------- 账号 ---------------- */
  function renderAccount() {
    const subscribeEmail = input({ type: 'email', placeholder: 'you@example.com' });
    const subBtn = el('button.btn.btn-ghost', { type: 'button' }, '订阅更新通知');
    subBtn.addEventListener('click', async () => {
      const email = subscribeEmail.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast.warning('请输入有效的邮箱地址');
      try {
        const res = await api.post('/subscribe', { email, source: 'settings' });
        toast.success(res.message || '订阅成功');
        subscribeEmail.value = '';
      } catch (err) {
        toast.error(err.message);
      }
    });

    panel.append(
      el('div.card-title', {}, '订阅更新'),
      el('div.row.wrap', { style: { gap: '10px', alignItems: 'flex-end' } }, [
        el('div.field', { style: { flex: '1', minWidth: '220px', marginBottom: '0' } }, [el('label', {}, '邮箱'), subscribeEmail]),
        subBtn,
      ]),

      el('div.card-title', { style: { marginTop: '28px' } }, '危险操作'),
      el('div.card.pad-sm', { style: { borderColor: 'color-mix(in srgb, var(--danger) 35%, transparent)' } }, [
        el('div.row-between.wrap', {}, [
          el('div', {}, [
            el('strong', {}, '导出全部数据'),
            el('p.small.muted', {}, '下载 JSON 备份，迁移到其他系统时使用'),
          ]),
          el('button.btn.btn-ghost', { type: 'button', onclick: doExport }, '导出'),
        ]),
      ]),
      el('div.card.pad-sm', { style: { marginTop: '10px', borderColor: 'color-mix(in srgb, var(--danger) 35%, transparent)' } }, [
        el('div.row-between.wrap', {}, [
          el('div', {}, [
            el('strong', {}, '退出登录'),
            el('p.small.muted', {}, '结束当前会话，需要重新输入密码'),
          ]),
          el('button.btn.btn-outline-danger', {
            type: 'button',
            onclick: async () => {
              const { logout } = await import('../lib/store.js');
              await logout();
              toast.success('已退出登录');
              go('/');
            },
          }, '退出'),
        ]),
      ]),
    );
  }

  async function doExport() {
    try {
      const data = await AuthAPI.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `hub-export-${Date.now()}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('数据已导出');
    } catch (err) {
      toast.error(err.message);
    }
  }

  function infoRow(k, v) {
    return el('div.row-between', { style: { fontSize: '0.88rem' } }, [
      el('span.muted', {}, k),
      el('span.truncate', { style: { maxWidth: '65%' } }, v || '—'),
    ]);
  }

  function keyRow(key, text) {
    return el('div.row', {}, [el('kbd', {}, key), el('span.muted', {}, text)]);
  }

  render();
}
