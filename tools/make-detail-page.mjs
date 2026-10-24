/**
 * 生成「已驱动交互」的验收页：自动选中指定插件并触发核验，
 * 用于截取详情面板（元数据 / 版本 / 许可证 / 检查项）。
 *
 * 用法：node tools/make-detail-page.mjs <outName> <pluginId> [--no-verify]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const [outName = 'detail', pluginId = 'hotkeysplus-obsidian'] = process.argv.slice(2);
const autoVerify = !process.argv.includes('--no-verify');

const harness = await readFile(path.join(ROOT, 'shots/harness.html'), 'utf8');

const driver = `
<script>
(function(){
  const targetId = ${JSON.stringify(pluginId)};
  const autoVerify = ${autoVerify};
  function attempt(n){
    const row = document.querySelector('.row[data-id="' + targetId + '"]');
    if (!row) { if (n > 40) return; return setTimeout(() => attempt(n+1), 100); }
    row.click();
    if (autoVerify) {
      setTimeout(() => {
        const b = document.getElementById('verifyOne');
        if (b) b.click();
      }, 250);
    }
  }
  setTimeout(() => attempt(0), 200);
})();
</script>
`;

const out = harness.replace('</body>', `${driver}</body>`);
const outPath = path.join(ROOT, 'shots', `${outName}.html`);
await writeFile(outPath, out, 'utf8');
console.log('已生成', outPath, '目标插件:', pluginId, '自动核验:', autoVerify);
