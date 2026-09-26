import { el, clear } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { ShortAPI } from '../lib/api.js';
import { timeAgo, dateShort } from '../lib/format.js';
import { empty, skeleton, copyable } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { modal, confirmDialog } from '../ui/modal.js';

export default async function shortView(host) {
  const urlInput = el('input.input', { placeholder: 'https://example.com/very/long/path?with=query', 'aria-label': '目标链接' });
  const codeInput = el('input.input', { placeholder: '自定义短码（可选，3-32 位）', maxlength: '32' });
  const titleInput = el('input.input', { placeholder: '备注标题（可选）' });
  const resultBox = el('div');
  const listNode = el('div');

  const createBtn = el('button.btn.btn-primary.btn-lg', { type: 'button' }, '生成短链');

  host.append(
    el('section.hero', { style: { padding: '48px 0 32px' } }, [
      el('div.container', { style: { maxWidth: '680px' } }, [
        el('h1', { style: { textAlign: 'center' } }, '短链生成器'),
        el('p.hero-sub', { style: { margin: '12px auto 0', textAlign: 'center' } },
          '粘贴长链接，一键缩短。支持自定义短码、点击统计与登录后管理自己的短链。'),
        el('div.card', { style: { marginTop: '28px' } }, [
          el('div.field', {}, [el('label', {}, '目标链接'), urlInput]),
          el('div.grid.grid-2', { style: { gap: '12px' } }, [
            el('div.field', {}, [el('label', {}, '自定义短码'), codeInput]),
            el('div.field', {}, [el('label', {}, '备注标题'), titleInput]),
          ]),
          resultBox,
          el('div.row', {}, [createBtn, store.user
            ? el('a.btn.btn-ghost', { href: '#/admin' }, '管理后台')
            : el('a.btn.btn-ghost', { href: '#/login' }, '登录后可管理短链')]),
        ]),
      ]),
    ]),

    store.user ? el('section.section.container', {}, [
      el('div.section-head', {}, [
        el('h2', {}, '我的短链'),
        el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: load }, '刷新'),
      ]),
      listNode,
    ]) : el('section.section.container', {}, [
      el('div.card.card-flat.center', {}, [
        el('p.muted', {}, '登录后可以查看、停用和删除自己创建的短链，并查看点击统计。'),
        el('a.btn.btn-primary', { href: '#/login?next=/short' }, '立即登录'),
      ]),
    ]),
  );

  createBtn.addEventListener('click', create);
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') create();
  });

  async function create() {
    const target = urlInput.value.trim();
    if (!/^https?:\/\/.+/.test(target)) {
      toast.warning('请输入以 http:// 或 https:// 开头的链接');
      urlInput.focus();
      return;
    }
    createBtn.setAttribute('aria-busy', 'true');
    createBtn.textContent = '生成中…';
    try {
      const { link } = await ShortAPI.create({
        target,
        code: codeInput.value.trim() || undefined,
        title: titleInput.value.trim() || undefined,
      });
      const full = `${location.origin}/${link.code}`;
      clear(resultBox);
      resultBox.append(
        el('div.alert.alert-success', { style: { marginBottom: '16px' } }, [
          el('div.grow', {}, [
            el('div', { style: { fontWeight: '600' } }, '生成成功！'),
            el('a.mono', { href: full, target: '_blank', rel: 'noopener' }, full),
          ]),
          copyable(full, '复制'),
        ]),
      );
      toast.success('短链已生成');
      urlInput.value = '';
      codeInput.value = '';
      titleInput.value = '';
      if (store.user) load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      createBtn.removeAttribute('aria-busy');
      createBtn.textContent = '生成短链';
    }
  }

  async function load() {
    if (!store.user) return;
    listNode.replaceChildren(skeleton(3));
    try {
      const { items, top } = await ShortAPI.list();
      listNode.replaceChildren();
      if (!items.length) {
        listNode.append(empty('还没有短链', '在上方生成第一个短链吧', null, '🔗'));
        return;
      }

      listNode.append(
        el('div.table-wrap', {}, [
          el('table', {}, [
            el('thead', {}, el('tr', {}, [
              el('th', {}, '短链'),
              el('th', {}, '目标'),
              el('th', {}, '标题'),
              el('th', {}, '点击'),
              el('th', {}, '状态'),
              el('th', {}, '操作'),
            ])),
            el('tbody', {}, items.map((link) => {
              const full = `${location.origin}/${link.code}`;
              return el('tr', {}, [
                el('td', {}, el('a.mono', { href: full, target: '_blank', rel: 'noopener' }, `/${link.code}`)),
                el('td', {}, el('a.truncate', {
                  href: link.target,
                  target: '_blank',
                  rel: 'noopener',
                  style: { display: 'block', maxWidth: '260px' },
                }, link.target)),
                el('td.small.muted', {}, link.title || '—'),
                el('td', {}, el('strong', {}, String(link.clicks))),
                el('td', {}, el(`span.badge${link.active ? '.badge-success' : '.badge-warning'}`, {}, link.active ? '启用' : '停用')),
                el('td', {}, el('div.row', { style: { gap: '4px' } }, [
                  el('button.icon-btn', {
                    type: 'button',
                    title: '复制',
                    onclick: (e) => {
                      navigator.clipboard.writeText(full);
                      e.currentTarget.textContent = '✓';
                      setTimeout(() => (e.currentTarget.textContent = '📋'), 1400);
                    },
                  }, '📋'),
                  el('button.icon-btn', {
                    type: 'button',
                    title: link.active ? '停用' : '启用',
                    onclick: async () => {
                      try {
                        await ShortAPI.update(link.id, { active: !link.active });
                        load();
                      } catch (err) {
                        toast.error(err.message);
                      }
                    },
                  }, link.active ? '⏸' : '▶️'),
                  el('button.icon-btn', {
                    type: 'button',
                    title: '删除',
                    onclick: async () => {
                      if (!(await confirmDialog({ title: '删除短链', message: `确定删除 /${link.code}？`, confirmText: '删除', danger: true }))) return;
                      try {
                        await ShortAPI.remove(link.id);
                        toast.success('已删除');
                        load();
                      } catch (err) {
                        toast.error(err.message);
                      }
                    },
                  }, '🗑'),
                ])),
              ]);
            })),
          ]),
        ]),
      );

      if (top?.length) {
        listNode.append(
          el('div.card.pad-sm', { style: { marginTop: '16px' } }, [
            el('div.card-title', {}, '🔥 点击量最高'),
            el('div.row.wrap', { style: { gap: '8px' } }, top.map((t) =>
              el('span.badge', {}, `/${t.code} · ${t.clicks} 次`),
            )),
          ]),
        );
      }
    } catch (err) {
      listNode.replaceChildren(el('div.alert.alert-danger', {}, err.message));
    }
  }

  load();
}
