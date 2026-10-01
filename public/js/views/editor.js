import { el, clear, $, debounce } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { PostAPI } from '../lib/api.js';
import { go, refresh } from '../lib/router.js';
import { markdownToHtml, wordCount } from '../lib/markdown.js';
import { toast } from '../ui/toast.js';
import { tagInput, select, segmented } from '../ui/components.js';

const DRAFT_KEY = 'hub.editor.draft';

export default async function editorView(host, ctx) {
  const isEdit = !!ctx.params.slug;
  let post = null;
  let categories = { items: [] };

  if (isEdit) {
    try {
      const res = await PostAPI.get(ctx.params.slug);
      post = res.post;
      if (post.author.id !== store.user.id && store.user.role !== 'admin') {
        toast.error('只能编辑自己的文章');
        go('/blog');
        return;
      }
    } catch (err) {
      toast.error(err.message);
      go('/blog');
      return;
    }
  } else {
    const saved = loadDraft();
    if (saved) post = saved;
  }

  categories = await PostAPI.categories().catch(() => ({ items: [] }));

  const state = {
    title: post?.title || '',
    content: post?.content || '',
    excerpt: post?.excerpt || '',
    categoryId: post?.category?.id || '',
    tags: post?.tags?.map((t) => t.name) || [],
    status: post?.status || 'draft',
    featured: post?.featured || false,
  };

  /* ---------- 控件 ---------- */
  const titleInput = el('input.input', {
    'aria-label': '文章标题', placeholder: '文章标题…',
    value: state.title,
    style: { fontSize: '1.5rem', fontWeight: '700', padding: '14px 18px' },
    maxlength: '120',
  });
  const contentArea = el('textarea.textarea', {
    'aria-label': '正文（Markdown）',
    placeholder: '用 Markdown 开始写作…\n\n## 二级标题\n- 列表项\n> 引用\n```js\n代码块\n```',
    style: { minHeight: '440px', fontFamily: 'var(--font-mono)', fontSize: '0.9rem', lineHeight: '1.75' },
  });
  contentArea.value = state.content;

  const excerptInput = el('textarea.textarea', { rows: 2, 'aria-label': '文章摘要', placeholder: '摘要（留空自动截取正文）', maxlength: '300' });
  excerptInput.value = state.excerpt;

  const categorySelect = select(
    [{ value: '', label: '未分类' }, ...categories.items.map((c) => ({ value: c.id, label: c.name }))],
    { 'aria-label': '分类' },
  );
  categorySelect.value = state.categoryId;

  const tagsField = tagInput(state.tags);

  const statusSeg = segmented(
    [{ value: 'draft', label: '草稿' }, { value: 'published', label: '发布' }],
    state.status,
    (v) => {
      state.status = v;
      saveDraft();
    },
  );

  const featureToggle = el('input', { type: 'checkbox', 'aria-label': '设为精选文章' });
  featureToggle.checked = !!state.featured;

  const counter = el('span.small.muted');
  const preview = el('div.prose', { style: { display: 'none' } });
  const editorPane = el('div', {}, [contentArea]);

  const saveBtn = el('button.btn.btn-primary', { type: 'button', onclick: () => save() }, isEdit ? '保存修改' : '创建文章');
  const publishBtn = el('button.btn.btn-soft', { type: 'button', onclick: () => save('published') }, isEdit ? '保存并发布' : '直接发布');
  const previewBtn = el('button.btn.btn-ghost', { type: 'button', onclick: togglePreview }, '👁 预览');

  /* ---------- 布局 ---------- */
  const sidebar = el('div.col', { style: { gap: '16px' } }, [
    el('div.card.pad-sm', {}, [
      el('div.card-title', {}, '发布设置'),
      el('div.field', {}, [el('label', {}, '状态'), statusSeg]),
      el('div.field', {}, [el('label', {}, '分类'), categorySelect]),
      el('div.field', {}, [el('label', {}, '标签'), tagsField]),
      el('label.switch', { style: { marginBottom: '12px' } }, [featureToggle, el('span.track'), el('span.small', {}, '设为精选（显示在首页）')]),
      el('button.btn.btn-ghost.btn-block.btn-sm', { type: 'button', onclick: () => clearDraft() }, '清除本地草稿'),
    ]),
    el('div.card.pad-sm', {}, [
      el('div.card-title', {}, '摘要 / SEO'),
      excerptInput,
      el('div.small.muted', { style: { marginTop: '6px' } }, '用于列表展示与分享卡片'),
    ]),
    el('div.card.pad-sm', {}, [
      el('div.card-title', {}, '写作统计'),
      counter,
      el('div.progress', { style: { marginTop: '10px' } }, [el('i', { id: 'read-progress', style: { width: '0%' } })]),
      el('div.small.muted', { style: { marginTop: '6px' } }, '系统按 400 字/分钟估算阅读时长'),
    ]),
  ]);

  host.append(
    el('div.row-between.wrap', { style: { marginBottom: '16px' } }, [
      el('div', {}, [
        el('h1', { style: { fontSize: 'var(--step-2)' } }, isEdit ? '编辑文章' : '写新文章'),
        el('p.small.muted', {}, '内容会自动保存为本地草稿，⌘/Ctrl + S 提交'),
      ]),
      el('div.row', {}, [previewBtn, publishBtn, saveBtn]),
    ]),
    el('div.grid.grid-sidebar', {}, [
      el('div.col', { style: { gap: '14px' } }, [
        titleInput,
        el('div.row.wrap', { style: { gap: '8px' } }, [
          el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => insert('**粗体**') }, 'B'),
          el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => insert('_斜体_') }, 'I'),
          el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => insert('~~删除线~~') }, 'S'),
          el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => insert('`代码`') }, '‹›'),
          el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => insert('\n[链接文字](https://)') }, '🔗'),
          el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => insert('\n- 列表项\n') }, '≡'),
          el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => insert('\n> 引用\n') }, '❝'),
          el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => insert('\n```js\n\n```\n') }, '{ }'),
          el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => insert('\n![alt](https://)\n') }, '🖼'),
        ]),
        el('div.card', { style: { padding: '0' } }, editorPane),
      ]),
      sidebar,
    ]),
  );

  /* ---------- 行为 ---------- */
  function collect() {
    return {
      title: titleInput.value.trim(),
      content: contentArea.value,
      excerpt: excerptInput.value.trim(),
      categoryId: categorySelect.value || null,
      tags: tagsField.getValues(),
      status: state.status,
      featured: featureToggle.checked,
    };
  }

  function updateCounter() {
    const wc = wordCount(contentArea.value);
    counter.textContent = `${wc.chars} 字符 · ${wc.cjk} 汉字 · ${wc.words} 词 · 约 ${Math.max(1, Math.round(wc.total / 400))} 分钟`;
    const progress = document.getElementById('read-progress');
    if (progress) progress.style.width = `${Math.min(100, (wc.total / 3000) * 100)}%`;
  }

  function insert(text) {
    const start = contentArea.selectionStart;
    const end = contentArea.selectionEnd;
    const selected = contentArea.value.slice(start, end);
    const value = selected ? text.replace(/\*\*/g, '').replace(/_/g, '') : text;
    contentArea.value = contentArea.value.slice(0, start) + value + contentArea.value.slice(end);
    contentArea.focus();
    contentArea.selectionStart = start + value.length;
    contentArea.selectionEnd = start + value.length;
    updateCounter();
    saveDraft();
  }

  function togglePreview() {
    const showing = preview.style.display !== 'none';
    if (showing) {
      preview.style.display = 'none';
      editorPane.replaceChildren(contentArea);
      previewBtn.textContent = '👁 预览';
    } else {
      preview.innerHTML = markdownToHtml(contentArea.value) || '<p class="muted">（空内容）</p>';
      preview.style.display = '';
      editorPane.replaceChildren(preview);
      previewBtn.textContent = '✏️ 编辑';
    }
  }

  function saveDraft() {
    if (isEdit) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...collect(), savedAt: Date.now() }));
    } catch {
      /* 忽略配额错误 */
    }
  }

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
    toast.success('已清除本地草稿');
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function save(forcedStatus) {
    const data = collect();
    if (forcedStatus) data.status = forcedStatus;

    if (!data.title) {
      toast.warning('请填写标题');
      titleInput.focus();
      return;
    }
    if (!data.content.trim()) {
      toast.warning('正文不能为空');
      contentArea.focus();
      return;
    }
    if (data.status === 'published' && store.user.role !== 'admin' && !store.user) {
      toast.error('请先登录');
      return;
    }

    saveBtn.setAttribute('aria-busy', 'true');
    publishBtn.setAttribute('aria-busy', 'true');
    try {
      const res = isEdit ? await PostAPI.update(post.id, data) : await PostAPI.create(data);
      clearDraft();
      toast.success(data.status === 'published' ? '文章已发布' : '已保存为草稿');
      go(`/blog/${res.post.slug}`, { replace: true });
    } catch (err) {
      toast.error(err.message);
      saveBtn.removeAttribute('aria-busy');
      publishBtn.removeAttribute('aria-busy');
    }
  }

  const persist = debounce(() => {
    if (!isEdit) saveDraft();
    updateCounter();
  }, 500);
  [titleInput, contentArea, excerptInput].forEach((node) => node.addEventListener('input', persist));
  categorySelect.addEventListener('change', saveDraft);
  featureToggle.addEventListener('change', saveDraft);

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });

  updateCounter();
  setTimeout(() => titleInput.focus(), 60);
}
