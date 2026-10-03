#!/usr/bin/env node
/**
 * 前端构建：把 client/ 编译到 public/assets/
 *   1. 合并压缩 CSS（去注释/空白，保留自定义属性的安全取值）
 *   2. 复制 ES Module 树（浏览器原生支持 import，无需打包器）
 *   3. 生成 app.js 入口与 manifest.json（用于 HTML 缓存击穿）
 */
import { readFile, writeFile, mkdir, rm, readdir, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(rootDir, 'client');
const outDir = path.join(rootDir, 'public', 'assets');

const CSS_ORDER = ['tokens.css', 'base.css', 'layout.css', 'components.css', 'modules.css', 'glass.css'];

/** 轻量 CSS 压缩：去注释、折叠空白、去掉最后一个分号。 */
function minifyCss(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/@media\s*([^{]+)\{/g, '@media $1 {')
    .trim();
}

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else files.push({ full, rel: path.relative(base, full) });
  }
  return files;
}

const hash = (text) => createHash('sha256').update(text).digest('base64url').slice(0, 10);

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // 1. CSS
  const cssParts = [];
  for (const name of CSS_ORDER) {
    const file = path.join(clientDir, 'css', name);
    if (!existsSync(file)) throw new Error(`缺少样式文件：${path.relative(rootDir, file)}`);
    cssParts.push(await readFile(file, 'utf8'));
  }
  const css = minifyCss(cssParts.join('\n'));

  // 2. JS 模块树
  const jsFiles = await walk(path.join(clientDir, 'js'));
  let entryFound = false;
  for (const { full, rel } of jsFiles) {
    const target = path.join(outDir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    const code = await readFile(full, 'utf8');
    await writeFile(target, code.trimEnd());
    if (rel === 'main.js') entryFound = true;
  }
  if (!entryFound) throw new Error('缺少前端入口 client/js/main.js');

  // 3. 入口与资源
  await writeFile(path.join(outDir, 'app.js'), "import './main.js';\n");
  await writeFile(path.join(outDir, 'favicon.svg'), favicon());
  await writeFile(path.join(outDir, 'app.css'), css);
  await copyFile(path.join(rootDir, 'public', 'robots.txt'), path.join(outDir, 'robots.txt')).catch(() => {});

  const manifest = { css: hash(css), js: hash(await readFile(path.join(outDir, 'app.js'), 'utf8')), builtAt: new Date().toISOString() };
  await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const { size } = await stat(path.join(outDir, 'app.css'));
  process.stdout.write(
    `构建完成：${jsFiles.length} 个模块，CSS ${(size / 1024).toFixed(1)} KB，版本 ${manifest.css}\n`,
  );
}

function favicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#4338ca"/>
  </linearGradient></defs>
  <rect width="64" height="64" rx="15" fill="url(#g)"/>
  <path d="M20 20v24M44 20v24M20 32h24" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
</svg>
`;
}

main().catch((error) => {
  process.stderr.write(`构建失败：${error.message}\n`);
  process.exit(1);
});
