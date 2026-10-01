import { el, clear, debounce } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { FileAPI, PostAPI } from '../lib/api.js';
import { humanSize, dateShort, timeAgo } from '../lib/format.js';
import { empty, skeleton, pager, copyable } from '../ui/components.js';
import { modal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';

const FOLDER_LABEL = { image: '图片', doc: '文档', archive: '压缩', media: '媒体', misc: '其他' };

export default async function filesView(host, ctx) {
  const state = { folder: ctx.query.folder || '', q: '', page: 1 };
  const grid = el('div');
  const sidebar = el('div.col', { style: { gap: '16px' } });
  const pagerNode = el('div');

  const fileInput = el('input', { type: 'file', multiple: true, 'aria-label': '选择要上传的文件', style: { display: 'none' } });

  const dropzone = el('div.dropzone', {}, [
    el('div', { style: { fontSize: '2rem' } }, '📤'),
    el('div', { style: { fontWeight: '600', marginTop: '8px' } }, '拖拽文件到此处，或点击选择'),
    el('div.small.muted', { style: { marginTop: '4px' } }, `单个文件最大 ${humanSize(10 * 1024 * 1024)}，图片可作图床使用`),
  ]);

  const listNode = el('div');
  const searchInput = el('input.input', { type: 'search', 'aria-label': '搜索文件名', placeholder: '搜索文件名…' });

  host.append(
    el('div.page-head', {}, [
      el('div.row-between.wrap', {}, [
        el('div', {}, [el('h1', {}, '文件与图床'), el('p', {}, '上传、分类管理与获取直链')]),
        el('button.btn.btn-primary', { type: 'button', onclick: () => fileInput.click() }, '⬆ 选择文件'),
      ]),
    ]),
    store.user ? dropzone : el('div.alert.alert-info', {}, ['登录后即可上传文件。', el('a', { href: '#/login' }, ' 去登录')]),
    el('div.card.pad-sm', { style: { marginBottom: '20px' } }, [el('div.row.wrap', {}, [searchInput, el('div#file-cats')])]),
    el('div.grid.grid-sidebar', {}, [listNode, sidebar]),
    pagerNode,
    fileInput,
  );

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) uploadFiles(fileInput.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('over');
    }),
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('over');
    }),
  );
  dropzone.addEventListener('click', () => {
    if (store.user) fileInput.click();
  });
  dropzone.addEventListener('drop', (e) => {
    if (!store.user) return toast.warning('请先登录');
    const files = e.dataTransfer.files;
    if (files.length) uploadFiles(files);
  });

  searchInput.addEventListener('input', () => {
    state.q = searchInput.value.trim();
    state.page = 1;
    load();
  });

  async function uploadFiles(fileList) {
    const files = Array.from(fileList);
    const max = 10 * 1024 * 1024;
    const tooBig = files.find((f) => f.size > max);
    if (tooBig) return toast.error(`「${tooBig.name}」超过 ${humanSize(max)} 限制`);

    let done = 0;
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      form.append('isPublic', 'true');
      try {
        await FileAPI.upload(form);
        done++;
      } catch (err) {
        toast.error(`${file.name}：${err.message}`);
      }
    }
    if (done) {
      toast.success(`成功上传 ${done} 个文件`);
      state.page = 1;
      load();
    }
  }

  async function load() {
    listNode.replaceChildren(skeleton(2));
    try {
      const data = await FileAPI.list({ folder: state.folder, q: state.q, page: state.page, size: 24 });
      listNode.replaceChildren();
      renderCats(data.usage.byFolder);
      renderSidebar(data.usage);

      if (!data.items.length) {
        listNode.append(
          empty('没有文件', state.q ? '换个关键词试试' : '上传第一个文件试试', null, '📁'),
        );
      } else {
        listNode.append(el('div.file-grid', {}, data.items.map(fileTile)));
      }

      pagerNode.replaceChildren();
      const p = pager({ page: data.page, pages: data.pages, onChange: (n) => { state.page = n; load(); } });
      if (p) pagerNode.append(p);
    } catch (err) {
      listNode.replaceChildren(el('div.alert.alert-danger', {}, err.message));
    }
  }

  function renderCats(byFolder) {
    const box = host.querySelector('#file-cats');
    clear(box);
    const chip = (label, value, active) => {
      const btn = el(`button.chip${active ? '.active' : ''}`, { type: 'button' }, label);
      btn.addEventListener('click', () => {
        state.folder = state.folder === value ? '' : value;
        state.page = 1;
        load();
      });
      box.append(btn);
    };
    chip('全部', '', !state.folder);
    for (const f of byFolder) chip(`${FOLDER_LABEL[f.folder] || f.folder} ${f.count}`, f.folder, state.folder === f.folder);
  }

  function renderSidebar(usage) {
    clear(sidebar);
    sidebar.append(
      el('div.card', {}, [
        el('div.card-title', {}, '💾 空间占用'),
        el('div', { style: { fontSize: '1.6rem', fontWeight: '800' } }, humanSize(usage.total)),
        el('div.col', { style: { gap: '6px', marginTop: '12px' } },
          usage.byFolder.map((f) => {
            const pct = usage.total ? Math.round((f.bytes / usage.total) * 100) : 0;
            return el('div', {}, [
              el('div.row-between.small', {}, [el('span.muted', {}, FOLDER_LABEL[f.folder] || f.folder), el('span', {}, `${humanSize(f.bytes)} · ${pct}%`)]),
              el('div.progress', { style: { marginTop: '3px', height: '5px' } }, [el('i', { style: { width: `${pct}%` } })]),
            ]);
          }),
        ),
      ]),
      el('div.card', {}, [
        el('div.card-title', {}, '💡 使用说明'),
        el('div.col', { style: { gap: '8px', fontSize: '0.85rem' } }, [
          tip('图床用法', '上传后在详情里复制 Markdown 链接'),
          tip('直链地址', '/uploads/文件名 可直接引用'),
          tip('私有文件', '编辑时关闭「公开」开关'),
        ]),
      ]),
    );
  }

  function tip(title, text) {
    return el('div', {}, [el('strong', {}, title), el('div.muted', {}, text)]);
  }

  function fileTile(file) {
    const isImage = file.mime.startsWith('image/');
    return el('div.file-tile', {}, [
      el('div.file-thumb', { style: { cursor: 'pointer' }, onclick: () => openDetail(file) },
        isImage
          ? el('img', { src: file.url, alt: file.filename, loading: 'lazy' })
          : el('span', {}, iconFor(file.mime))),
      el('div.file-info', {}, [
        el('div.n.truncate', { title: file.filename }, file.filename),
        el('div.row-between', { style: { marginTop: '4px' } }, [
          el('span.small.muted', {}, humanSize(file.size)),
          el('span.badge', {}, FOLDER_LABEL[file.folder] || file.folder),
        ]),
      ]),
    ]);
  }

  function openDetail(file) {
    const isImage = file.mime.startsWith('image/');
    const url = `${location.origin}${file.url}`;
    const mdLink = `![${file.filename}](${file.url})`;
    const body = el('div.col', { style: { gap: '14px' } }, [
      isImage
        ? el('img', { src: file.url, alt: '', style: { borderRadius: '12px', maxHeight: '280px', objectFit: 'contain', background: 'var(--surface-3)', width: '100%' } })
        : el('div', { style: { textAlign: 'center', fontSize: '3rem', padding: '20px' } }, iconFor(file.mime)),
      el('div.list', {}, [
        infoRow('文件名', file.filename),
        infoRow('类型', file.mime),
        infoRow('大小', humanSize(file.size)),
        infoRow('上传时间', dateShort(file.createdAt)),
        infoRow('下载次数', String(file.downloads)),
        infoRow('可见性', file.isPublic ? '公开' : '私有'),
      ]),
      el('div.field', {}, [
        el('label', {}, '直链'),
        el('div.input-group', {}, [
          el('input.input', { value: url, readonly: true, onclick: (e) => e.target.select() }),
          copyable(url, '复制'),
        ]),
      ]),
      isImage
        ? el('div.field', {}, [
            el('label', {}, 'Markdown'),
            el('div.input-group', {}, [
              el('input.input', { value: mdLink, readonly: true, onclick: (e) => e.target.select() }),
              copyable(mdLink, '复制'),
            ]),
          ])
        : null,
      el('div.row', {}, [
        el('a.btn.btn-ghost.btn-sm', { href: file.url, target: '_blank', rel: 'noopener' }, '打开原文件'),
        store.user
          ? el('button.btn.btn-ghost.btn-sm', {
              type: 'button',
              onclick: async () => {
                const next = !file.isPublic;
                try {
                  await FileAPI.update(file.id, { isPublic: next });
                  toast.success(next ? '已设为公开' : '已设为私有');
                  dlg.close();
                  load();
                } catch (err) {
                  toast.error(err.message);
                }
              },
            }, file.isPublic ? '设为私有' : '设为公开')
          : null,
        store.user
          ? el('button.btn.btn-outline-danger.btn-sm', {
              type: 'button',
              onclick: async () => {
                if (!(await confirmDialog({ title: '删除文件', message: `确定永久删除「${file.filename}」？`, confirmText: '删除', danger: true }))) return;
                try {
                  await FileAPI.remove(file.id);
                  toast.success('文件已删除');
                  dlg.close();
                  load();
                } catch (err) {
                  toast.error(err.message);
                }
              },
            }, '删除')
          : null,
      ]),
    ]);
    const dlg = modal({ title: file.filename, wide: true, body });
  }

  await load();
}

function infoRow(k, v) {
  return el('div.row-between', { style: { fontSize: '0.88rem' } }, [
    el('span.muted', {}, k),
    el('span.truncate', { style: { maxWidth: '60%' } }, v),
  ]);
}

function iconFor(mime) {
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip')) return '🗜️';
  if (mime.includes('json') || mime.includes('text')) return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  return '📦';
}
