/**
 * 构建脚本：把 src/*.mjs 与 web/app.js 内联成单文件 HTML。
 *
 * 为什么要内联：Chrome 对 file:// 下的 ES module 有 CORS 限制，直接用
 * <script type="module" src> 会失败。内联成单一 IIFE 后，双击 HTML 即可用，
 * 不需要起本地服务器（也就不用长期挂一个进程）。
 *
 * 零依赖：只做文本级转换（去 import/export），不做 AST 解析。
 * 转换的安全性由「模块间无重名符号」保证，构建后会做一次符号冲突检查。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** 依赖顺序：被依赖者在前。 */
const MODULES = ['src/sources.mjs', 'src/license.mjs', 'src/verify.mjs', 'src/indexer.mjs'];

function stripModuleSyntax(code) {
  return code
    // 去掉 import 语句（含多行）
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '')
    // 去掉 export 关键字，保留声明
    .replace(/^export\s+(async\s+function|function|const|let|var|class)\s/gm, '$1 ')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
}

/** 收集顶层声明名，用于检测跨模块重名。 */
function topLevelNames(code) {
  const names = new Set();
  const re = /^(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(code))) names.add(m[1]);
  return names;
}

const parts = [];
const owner = new Map();
const collisions = [];

for (const rel of MODULES) {
  const raw = await readFile(path.join(ROOT, rel), 'utf8');
  const code = stripModuleSyntax(raw);
  for (const name of topLevelNames(code)) {
    if (owner.has(name)) collisions.push(`${name} (${owner.get(name)} vs ${rel})`);
    else owner.set(name, rel);
  }
  parts.push(`/* ===== ${rel} ===== */\n${code}`);
}

if (collisions.length) {
  console.error('符号冲突，内联会互相覆盖：');
  collisions.forEach((c) => console.error('  - ' + c));
  process.exit(1);
}

const appJs = await readFile(path.join(ROOT, 'web/app.js'), 'utf8');
const css = await readFile(path.join(ROOT, 'web/app.css'), 'utf8');
const tpl = await readFile(path.join(ROOT, 'web/index.template.html'), 'utf8');

const bundle = `(function(){\n'use strict';\n${parts.join('\n\n')}\n\n/* ===== web/app.js ===== */\n${appJs}\n})();`;

const html = tpl
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => bundle)
  .replace('__BUILD_TIME__', new Date().toISOString());

await writeFile(path.join(ROOT, 'web/dist/ext-audit.html'), html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`构建完成：web/dist/ext-audit.html  ${kb} KB`);
console.log(`模块符号 ${owner.size} 个，无冲突`);
