/** 轻量 Markdown → HTML 渲染器（支持标题/列表/表格/代码/引用/链接/高亮语法） */
import { esc } from './dom.js';

const escapeHtml = esc;

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, src) =>
    `<img src="${src}" alt="${alt}" loading="lazy" onerror="this.style.display='none'">`);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, href) => {
    const external = /^https?:\/\//.test(href);
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) =>
    `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  out = out.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, '<span class="mention">@$1</span>');
  return out;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function tableRow(line) {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

export function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;

  const flushParagraph = (buf) => {
    if (buf.length) html.push(`<p>${inline(buf.join(' '))}</p>`);
    buf.length = 0;
  };
  const para = [];

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (/^```/.test(line)) {
      flushParagraph(para);
      const lang = line.slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++;
      html.push(
        `<pre data-lang="${escapeHtml(lang)}"><code class="lang-${escapeHtml(lang || 'text')}">${escapeHtml(body.join('\n'))}</code></pre>`,
      );
      continue;
    }

    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(para);
      const level = heading[1].length;
      const text = heading[2].trim();
      html.push(
        level <= 2
          ? `<h${level} id="${slugify(text)}">${inline(text)}</h${level}>`
          : `<h${level}>${inline(text)}</h${level}>`,
      );
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushParagraph(para);
      html.push('<hr>');
      i++;
      continue;
    }

    // 表格
    if (line.includes('|') && /^\s*\|?[\s:-]*\|[\s:|-]*$/.test(lines[i + 1] || '')) {
      flushParagraph(para);
      const head = tableRow(line);
      const align = tableRow(lines[i + 1]).map((c) => {
        if (/^:.*:$/.test(c)) return 'center';
        if (/:$/.test(c)) return 'right';
        if (/^:/.test(c)) return 'left';
        return '';
      });
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(tableRow(lines[i]));
        i++;
      }
      html.push(
        `<table><thead><tr>${head
          .map((c, idx) => `<th${align[idx] ? ` style="text-align:${align[idx]}"` : ''}>${inline(c)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c, idx) => `<td${align[idx] ? ` style="text-align:${align[idx]}"` : ''}>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      flushParagraph(para);
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      html.push(`<blockquote>${renderMarkdown(body.join('\n')).html || `<p>${inline(body.join(' '))}</p>`}</blockquote>`);
      continue;
    }

    // 任务列表
    if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+\[[ xX]\]\s+/.test(lines[i])) {
        const m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(lines[i]);
        items.push(
          `<li class="task"><input type="checkbox" disabled ${m[1].toLowerCase() === 'x' ? 'checked' : ''}> <span>${inline(m[2])}</span></li>`,
        );
        i++;
      }
      html.push(`<ul class="task-list">${items.join('')}</ul>`);
      continue;
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
        i++;
      }
      html.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]) && !/^\s*[-*+]\s+\[/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*+]\s+/, ''))}</li>`);
        i++;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // 空行
    if (!line.trim()) {
      flushParagraph(para);
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushParagraph(para);
  return { html: html.join('\n') };
}

export function markdownToHtml(src) {
  return renderMarkdown(src).html;
}

export function excerpt(src, len = 140) {
  const text = String(src || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > len ? `${text.slice(0, len)}…` : text;
}

export function wordCount(src) {
  const text = stripTags(String(src || ''));
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return { chars: text.length, cjk, words, total: cjk + words };
}

function stripTags(s) {
  return s;
}
