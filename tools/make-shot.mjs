/**
 * 生成用于 README 的截图页并驱动交互。
 * 模式：
 *   overview  仅加载列表，不选中
 *   detail    选中指定插件并核验
 *   limits    打开「数据时间与局限」弹窗
 *
 * 用法：node tools/make-shot.mjs <mode> <outName> [pluginId]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const [mode = 'overview', outName = 'shot', pluginId = 'hotkeysplus-obsidian'] = process.argv.slice(2);

const harness = await readFile(path.join(ROOT, 'shots/harness.html'), 'utf8');

const DRIVERS = {
  overview: `
    // 不选中任何插件，只展示列表与空态
  `,
  detail: `
    function attempt(n){
      const row = document.querySelector('.row[data-id="${pluginId}"]');
      if (!row) { if (n > 60) return; return setTimeout(() => attempt(n+1), 100); }
      row.click();
      setTimeout(() => {
        const b = document.getElementById('verifyOne');
        if (b) b.click();
      }, 250);
    }
    setTimeout(() => attempt(0), 200);
  `,
  limits: `
    setTimeout(() => {
      const b = document.getElementById('openLimits');
      if (b) b.click();
    }, 600);
  `,
};

const page = harness.replace(
  '</body>',
  `<script>(function(){${DRIVERS[mode] || ''}})();</script></body>`,
);

await writeFile(path.join(ROOT, 'shots', `${outName}.html`), page, 'utf8');
console.log(`已生成 shots/${outName}.html  mode=${mode}  plugin=${pluginId}`);
