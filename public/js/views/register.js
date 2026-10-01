import { el, $, debounce } from '../lib/dom.js';
import { register, store } from '../lib/store.js';
import { go } from '../lib/router.js';
import { AuthAPI } from '../lib/api.js';
import { toast } from '../ui/toast.js';

export default async function registerView(host, ctx) {
  if (store.user) {
    go(ctx.query.next || '/dashboard', { replace: true });
    return;
  }
  if (store.settings.allow_registration === false) {
    host.className = 'auth-wrap';
    host.append(
      el('div.auth-card', {}, [
        el('div.auth-head', {}, [el('div.logo', {}, 'H'), el('h1', { style: { fontSize: '1.4rem' } }, '注册已关闭')]),
        el('p.muted.small', {}, '站点管理员已暂停新用户注册。'),
        el('a.btn.btn-primary.btn-block', { href: '#/login' }, '返回登录'),
      ]),
    );
    return;
  }

  const next = ctx.query.next || '/dashboard';

  const strength = el('div.strength', {}, [el('i'), el('i'), el('i'), el('i')]);
  const strengthText = el('div.hint', {}, '至少 6 位字符');

  const form = el('form', { novalidate: true }, [
    el('div.field', {}, [
      el('label', { for: 'username' }, '用户名'),
      el('input.input', { id: 'username', name: 'username', autocomplete: 'username', 'aria-label': '用户名', placeholder: '3-24 位，字母数字下划线', required: true }),
      el('span.hint', {}, '将作为你的主页地址 /u/用户名'),
    ]),
    el('div.field', {}, [
      el('label', { for: 'email' }, '邮箱'),
      el('input.input', { id: 'email', name: 'email', type: 'email', autocomplete: 'email', 'aria-label': '邮箱', placeholder: 'you@example.com', required: true }),
    ]),
    el('div.field', {}, [
      el('label', { for: 'password' }, '密码'),
      el('input.input', { id: 'password', name: 'password', type: 'password', autocomplete: 'new-password', 'aria-label': '密码', placeholder: '至少 6 位', required: true }),
      strength,
      strengthText,
    ]),
    el('div.field', {}, [
      el('label', { for: 'confirm' }, '确认密码'),
      el('input.input', { id: 'confirm', name: 'confirm', type: 'password', autocomplete: 'new-password', 'aria-label': '确认密码', placeholder: '再输入一次', required: true }),
    ]),
    el('div.field', {}, [
      el('label.checkbox', {}, [
        el('input', { type: 'checkbox', id: 'agree', required: true }),
        el('span.small', {}, '我已阅读并同意站点使用规范'),
      ]),
    ]),
    el('div#reg-err'),
    el('button.btn.btn-primary.btn-block.btn-lg', { type: 'submit' }, '创建账号'),
  ]);

  host.className = 'auth-wrap';
  host.append(
    el('div.container', { style: { maxWidth: '440px' } }, [
      el('div.auth-card', {}, [
        el('div.auth-head', {}, [
          el('div.logo', {}, 'H'),
          el('h1', { style: { fontSize: '1.5rem' } }, '创建账号'),
          el('p.muted.small', {}, '第一个注册的账号会自动成为管理员'),
        ]),
        form,
        el('p.auth-alt', {}, ['已有账号？', el('a', { href: `#/login?next=${encodeURIComponent(next)}` }, '去登录')]),
      ]),
    ]),
  );

  const pw = $('#password');
  pw.addEventListener(
    'input',
    debounce(async () => {
      const value = pw.value;
      if (!value) {
        strengthText.textContent = '至少 6 位字符';
        reset();
        return;
      }
      let score = 0;
      try {
        ({ score } = await AuthAPI.passwordScore(value));
      } catch {
        score = Math.min(4, Math.floor(value.length / 4));
      }
      const labels = ['很弱', '较弱', '一般', '较强', '很强'];
      strengthText.textContent = `强度：${labels[score]}`;
      [...strength.children].forEach((bar, i) => {
        bar.className = i < score ? `on-${score}` : '';
      });
    }, 220),
  );

  function reset() {
    [...strength.children].forEach((bar) => (bar.className = ''));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#reg-err');
    errBox.replaceChildren();
    const values = {
      username: form.username.value.trim(),
      email: form.email.value.trim(),
      password: form.password.value,
      confirm: form.confirm.value,
      agree: form.agree.checked,
    };

    const fail = (msg) => errBox.append(el('div.alert.alert-danger', {}, msg));

    if (values.username.length < 3) return fail('用户名至少 3 个字符');
    if (!/^[\w\u4e00-\u9fa5-]+$/.test(values.username)) return fail('用户名只能包含字母、数字、下划线、连字符或中文');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) return fail('邮箱格式不正确');
    if (values.password.length < 6) return fail('密码至少 6 位');
    if (values.password !== values.confirm) return fail('两次输入的密码不一致');
    if (!values.agree) return fail('请先同意使用规范');

    const btn = form.querySelector('button[type=submit]');
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = '创建中…';
    try {
      const user = await register({
        username: values.username,
        email: values.email,
        password: values.password,
      });
      toast.success(`注册成功，欢迎 ${user.nickname || user.username}！`);
      go(values.username === 'admin' ? '/admin' : next, { replace: true });
    } catch (err) {
      fail(err.message);
      btn.removeAttribute('aria-busy');
      btn.textContent = '创建账号';
    }
  });
}
