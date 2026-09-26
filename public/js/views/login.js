import { el, $ } from '../lib/dom.js';
import { login, store } from '../lib/store.js';
import { go } from '../lib/router.js';
import { AuthAPI } from '../lib/api.js';
import { toast } from '../ui/toast.js';

export default async function loginView(host, ctx) {
  if (store.user) {
    go(ctx.query.next || '/dashboard', { replace: true });
    return;
  }

  const next = ctx.query.next || '/dashboard';

  const form = el('form', { novalidate: true }, [
    el('div.field', {}, [
      el('label', { for: 'login' }, '账号 / 邮箱'),
      el('input.input', { id: 'login', name: 'login', autocomplete: 'username', placeholder: 'admin 或 admin@hub.dev', required: true }),
    ]),
    el('div.field', {}, [
      el('label', { for: 'password' }, '密码'),
      el('div.input-group', {}, [
        el('input.input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', placeholder: '请输入密码', required: true }),
        el('button.icon-btn', { type: 'button', id: 'toggle-pw', 'aria-label': '显示密码' }, '👁'),
      ]),
    ]),
    el('div.row-between', { style: { marginBottom: '16px' } }, [
      el('label.checkbox', {}, [el('input', { type: 'checkbox', id: 'remember' }), el('span', {}, '记住我')]),
      el('a.small', { href: '#/settings', style: { display: 'none' } }, '忘记密码'),
    ]),
    el('div#login-err'),
    el('button.btn.btn-primary.btn-block.btn-lg', { type: 'submit' }, '登录'),
  ]);

  const card = el('div.auth-card', {}, [
    el('div.auth-head', {}, [
      el('div.logo', {}, 'H'),
      el('h1', { style: { fontSize: '1.5rem' } }, '欢迎回来'),
      el('p.muted.small', {}, '登录后同步你的笔记、待办与文件'),
    ]),
    form,
    el('p.auth-alt', {}, ['还没有账号？', el('a', { href: `#/register?next=${encodeURIComponent(next)}` }, '立即注册')]),
    el('div.demo-box', {}, [
      el('div', { style: { fontWeight: '600', marginBottom: '6px' } }, '演示账号'),
      el('div', {}, ['管理员：', el('code', {}, 'admin@hub.dev'), ' / ', el('code', {}, 'admin12345')]),
      el('div', {}, ['普通用户：', el('code', {}, 'demo@hub.dev'), ' / ', el('code', {}, 'demo12345')]),
      el('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        style: { marginTop: '8px' },
        onclick: () => {
          $('#login').value = 'admin@hub.dev';
          $('#password').value = 'admin12345';
          $('#password').focus();
        },
      }, '一键填入管理员账号'),
    ]),
  ]);

  host.className = 'auth-wrap';
  host.append(el('div.container', { style: { maxWidth: '440px' } }, card));

  $('#toggle-pw').addEventListener('click', (e) => {
    const input = $('#password');
    input.type = input.type === 'password' ? 'text' : 'password';
    e.currentTarget.textContent = input.type === 'password' ? '👁' : '🙈';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const errBox = $('#login-err');
    errBox.replaceChildren();
    const loginId = form.login.value.trim();
    const password = form.password.value;

    if (!loginId || !password) {
      errBox.append(el('div.alert.alert-danger', {}, '请填写账号与密码'));
      return;
    }

    btn.setAttribute('aria-busy', 'true');
    btn.textContent = '登录中…';
    try {
      const user = await login(loginId, password);
      toast.success(`欢迎回来，${user.nickname || user.username}`);
      go(next, { replace: true });
    } catch (err) {
      errBox.append(el('div.alert.alert-danger', {}, err.message));
      btn.removeAttribute('aria-busy');
      btn.textContent = '登录';
      $('#password').select();
    }
  });

  setTimeout(() => $('#login')?.focus(), 60);
}
