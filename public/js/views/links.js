import { el, debounce } from '../lib/dom.js';
import { LinkAPI } from '../lib/api.js';
import { timeAgo, dateShort } from '../lib/format.js';
import { empty, skeleton, tagInput, select, segmented } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { modal, confirmDialog } from '../ui/modal.js';

const CATEGORIES = [
  { value: 'general', label: '通用' },
  { value: 'dev', label: '开发' },
  { value: 'design', label: '设计' },
  { value: 'read', label: '阅读' },
  { value: 'tool', label: '工具' },
  { value: 'fun', label: '娱乐' },
];

export default async function linksView(host, ctx) {
  const state = { q: '', category: '', starred: false, sort: 'new' };
  const grid = el('div');
  const toolbar = el('div.col', { style: { gap: '12px', marginBottom: '18px' } });

  host.append(
    el('div.page-head', {}, [
      el('div.row-between.wrap', {}, [
        el('div', {}, [el('h1', {}, '书签收藏'), el('p', {}, '把值得反复打开的链接都收在这里')]),
        el('button.btn.btn-primary', { type: 'button', onclick: () => openEditor() }, '✚ 添加链接'),
      ]),
    ]),
    toolbar,
    grid,
  );

  const search = el('input.input', { type: 'search', 'aria-label': '搜索书签', placeholder: '搜索标题、网址或备注…' });
  search.addEventListener('input', debounce(() => {
    state.q = search.value.trim();
    load();
  }, 300));

  toolbar.append(
    el('div.row.wrap', {}, [search, el('div#link-sort'), el('div#link-star')]),
    el('div.row.wrap#link-cats', { style: { gap: '6px' } }),
  );

  function renderChips(categories) {
    const box = host.querySelector('#link-cats');
    box.replaceChildren();
    const addChip = (label, value, active) => {
      const btn = el(`button.chip${active ? '.active' : ''}`, { type: 'button' }, label);
      btn.addEventListener('click', () => {
        state.category = state.category === value && value ? '' : value;
        load();
      });
      box.append(btn);
    };
    addChip('全部', '', !state.category);
    for (const c of categories) addChip(`${c.category} ${c.c}`, c.category, state.category === c.category);
  }

  async function load() {
    grid.replaceChildren(skeleton(3));
    try {
      const data = await LinkAPI.list({
        q: state.q,
        category: state.category,
        starred: state.starred ? 'true' : undefined,
        sort: state.sort,
      });
      grid.replaceChildren();
      renderChips(data.categories);

      if (!data.items.length) {
        grid.append(
          empty(
            state.q || state.category ? '没有匹配的链接' : '还没有收藏',
            state.q || state.category ? '试试其他关键词' : '把常用网址收进来，随时可查',
            el('button.btn.btn-primary', { type: 'button', onclick: () => openEditor() }, '添加第一个'),
            '🔖',
          ),
        );
        return;
      }

      for (const [category, items] of Object.entries(data.grouped)) {
        const section = el('section', { style: { marginBottom: '28px' } }, [
          el('div.section-head', { style: { marginBottom: '12px' } }, [
            el('h2', { style: { fontSize: '1.1rem' } }, categoryLabel(category)),
            el('span.small.muted', {}, `${items.length} 个`),
          ]),
          el('div.grid.grid-3', {}, items.map(linkCard)),
        ]);
        grid.append(section);
      }
    } catch (err) {
      grid.replaceChildren(el('div.alert.alert-danger', {}, err.message));
    }
  }

  function linkCard(link) {
    let host_ = null;
    const openLink = async (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      try {
        await LinkAPI.click(link.id);
      } catch {
        /* 统计失败不阻塞跳转 */
      }
      window.open(link.url, '_blank', 'noopener');
    };

    const favicon = el('img', {
      src: link.favicon,
      alt: '',
      loading: 'lazy',
      onerror: (e) => {
        e.target.replaceWith(el('span', {}, '🔗'));
      },
    });

    return el('div.link-card', {}, [
      el('a.link-icon', {
        href: link.url,
        target: '_blank',
        rel: 'noopener',
        onclick: openLink,
        'aria-label': `打开 ${link.title || link.url}`,
        title: link.title || link.url,
      }, favicon),
      el('div.grow', { style: { minWidth: '0' } }, [
        el('a', { href: link.url, target: '_blank', rel: 'noopener', onclick: openLink, style: { color: 'var(--text)', fontWeight: '600' } },
          el('span.truncate', { style: { display: 'block' } }, link.title)),
        el('a.small.muted.truncate', { href: link.url, target: '_blank', rel: 'noopener', style: { display: 'block' } },
          link.url.replace(/^https?:\/\//, '').slice(0, 40)),
        link.note ? el('p.small.soft.clamp-2', { style: { marginTop: '4px' } }, link.note) : null,
        el('div.row.wrap', { style: { gap: '6px', marginTop: '6px' } }, [
          link.tags.map((t) => el('span.badge', {}, `#${t}`)),
          el('span.grow'),
          el('span.small.muted', { title: `已点击 ${link.clicks} 次` }, `👆 ${link.clicks}`),
        ]),
      ]),
      el('div.col', { style: { gap: '2px' } }, [
        el('button.icon-btn', {
          type: 'button',
          title: link.starred ? '取消收藏' : '标星',
          onclick: async () => {
            try {
              await LinkAPI.update(link.id, { starred: !link.starred });
              load();
            } catch (err) {
              toast.error(err.message);
            }
          },
        }, link.starred ? '⭐' : '☆'),
        el('button.icon-btn', { type: 'button', title: '编辑', onclick: () => openEditor(link) }, '✏️'),
        el('button.icon-btn', { type: 'button', title: '删除', onclick: () => removeLink(link) }, '🗑'),
      ]),
    ]);
  }

  async function removeLink(link) {
    if (!(await confirmDialog({ title: '删除书签', message: `确定删除「${link.title}」？`, confirmText: '删除', danger: true }))) return;
    try {
      await LinkAPI.remove(link.id);
      toast.success('已删除');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  function openEditor(link = null) {
    const titleInput = el('input.input', { 'aria-label': '网站名称', placeholder: '网站名称', value: link?.title || '' });
    const urlInput = el('input.input', { type: 'url', 'aria-label': '网址', placeholder: 'https://example.com', value: link?.url || '' });
    const noteInput = el('textarea.textarea', { rows: 3, 'aria-label': '备注', placeholder: '备注：为什么收藏它？' });
    noteInput.value = link?.note || '';
    const categorySelect = select(CATEGORIES, {});
    categorySelect.value = link?.category || 'general';
    const tagsWidget = tagInput(link?.tags || []);
    const starInput = el('input', { type: 'checkbox' });
    starInput.checked = !!link?.starred;

    const body = el('form', { onsubmit: (e) => e.preventDefault() }, [
      el('div.field', {}, [el('label', {}, '标题'), titleInput]),
      el('div.field', {}, [el('label', {}, '网址'), urlInput]),
      el('div.field', {}, [el('label', {}, '备注'), noteInput]),
      el('div.field', {}, [el('label', {}, '分类'), categorySelect]),
      el('div.field', {}, [el('label', {}, '标签'), tagsWidget]),
      el('label.switch', {}, [starInput, el('span.track'), el('span.small', {}, '标星')]),
    ]);

    const saveBtn = el('button.btn.btn-primary', { type: 'button' }, link ? '保存' : '添加');
    const dlg = modal({ title: link ? '编辑书签' : '添加书签', body, footer: [saveBtn] });

    saveBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      const url = urlInput.value.trim();
      if (!title) return toast.warning('请填写标题');
      if (!/^https?:\/\//.test(url)) return toast.warning('网址必须以 http:// 或 https:// 开头');
      const payload = {
        title,
        url,
        note: noteInput.value.trim(),
        category: categorySelect.value,
        tags: tagsWidget.getValues(),
        starred: starInput.checked,
      };
      saveBtn.setAttribute('aria-busy', 'true');
      try {
        if (link) await LinkAPI.update(link.id, payload);
        else await LinkAPI.create(payload);
        dlg.close();
        toast.success(link ? '已保存' : '书签已添加');
        load();
      } catch (err) {
        toast.error(err.message);
        saveBtn.removeAttribute('aria-busy');
      }
    });
  }

  host.querySelector('#link-sort').append(
    segmented(
      [{ value: 'new', label: '最新' }, { value: 'clicks', label: '最常点' }, { value: 'title', label: '按名称' }],
      state.sort,
      (v) => {
        state.sort = v;
        load();
      },
    ),
  );
  host.querySelector('#link-star').append(
    segmented(
      [{ value: false, label: '全部' }, { value: true, label: '⭐ 标星' }],
      state.starred,
      (v) => {
        state.starred = v;
        load();
      },
    ),
  );

  await load();
}

function categoryLabel(value) {
  return CATEGORIES.find((c) => c.value === value)?.label || value;
}
