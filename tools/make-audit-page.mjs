/**
 * 生成「页面内布局审计」页：在真实渲染后收集几何、溢出与对比度数据，
 * 写进 <pre id="audit-out">。配合 --dump-dom 即可取得数值证据，
 * 不依赖读图能力。
 *
 * 用法：node tools/make-audit-page.mjs <outName> <pluginId>
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const [outName = 'audit', pluginId = 'hotkeysplus-obsidian'] = process.argv.slice(2);

const harness = await readFile(path.join(ROOT, 'shots/harness.html'), 'utf8');

const audit = `
<script>
(function(){
  const targetId = ${JSON.stringify(pluginId)};

  function lum(c){
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    return 0.2126*f(p[0]) + 0.7152*f(p[1]) + 0.0722*f(p[2]);
  }
  function ratio(a, b){
    const la = lum(a), lb = lum(b);
    if (la === null || lb === null) return null;
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  function bgOf(el){
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  }

  function collect(){
    const out = { viewport: { w: innerWidth, h: innerHeight }, issues: [], metrics: {} };

    // 1. 水平溢出
    out.metrics.docScrollWidth = document.documentElement.scrollWidth;
    out.metrics.horizontalOverflow = document.documentElement.scrollWidth > innerWidth + 1;
    if (out.metrics.horizontalOverflow) out.issues.push('页面出现横向溢出');

    // 2. 关键区域是否可见且有尺寸
    const regions = ['#q','#rows','#detail','footer.foot','.search-wrap','header.top'];
    out.regions = {};
    for (const sel of regions) {
      const el = document.querySelector(sel);
      if (!el) { out.issues.push('缺失区域 ' + sel); continue; }
      const r = el.getBoundingClientRect();
      out.regions[sel] = { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
      if (r.width < 2 || r.height < 2) out.issues.push('区域尺寸异常 ' + sel);
    }

    // 3. 正文对比度（抽样关键文本元素）
    const samples = ['.d-title','.d-desc','dl.kv dt','dl.kv dd','.check .cdetail','.row .rname','.row .rmeta','footer.foot','.list-meta'];
    out.contrast = [];
    for (const sel of samples) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const cr = ratio(cs.color, bgOf(el));
      const fs = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 600;
      const large = fs >= 24 || (fs >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      out.contrast.push({ sel, fontSize: fs, ratio: cr === null ? null : Number(cr.toFixed(2)), need, ok: cr !== null && cr >= need });
      if (cr !== null && cr < need) out.issues.push('对比度不足 ' + sel + ' ' + cr.toFixed(2) + ' < ' + need);
    }

    // 4. 文本被裁剪检测（scrollWidth 明显大于 clientWidth 且 overflow hidden）
    out.clipped = [];
    document.querySelectorAll('.rdesc, .d-title, .ctitle, .badge').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.overflow === 'hidden' && el.scrollWidth > el.clientWidth + 2) {
        out.clipped.push({ cls: el.className, text: (el.textContent||'').slice(0,40) });
      }
    });

    // 5. 内容完整性
    out.metrics.rowCount = document.querySelectorAll('.row').length;
    out.metrics.checkCount = document.querySelectorAll('.check').length;
    out.metrics.verdictBadges = [...document.querySelectorAll('.d-head .badge')].map(b => b.textContent.trim());
    out.metrics.sections = [...document.querySelectorAll('section.block h3')].map(h => h.textContent.trim());

    return out;
  }

  function attempt(n){
    const row = document.querySelector('.row[data-id="' + targetId + '"]');
    if (!row) { if (n > 50) return; return setTimeout(() => attempt(n+1), 100); }
    row.click();
    setTimeout(() => {
      const b = document.getElementById('verifyOne');
      if (b) b.click();
      // 等待核验完成：重试退避最多 2 次（0.7s + 1.4s），留足余量
      setTimeout(() => {
        const pre = document.createElement('pre');
        pre.id = 'audit-out';
        pre.textContent = JSON.stringify(collect(), null, 1);
        document.body.appendChild(pre);
      }, 4200);
    }, 250);
  }
  setTimeout(() => attempt(0), 200);
})();
</script>
`;

await writeFile(path.join(ROOT, 'shots', `${outName}.html`), harness.replace('</body>', `${audit}</body>`), 'utf8');
console.log('已生成 shots/' + outName + '.html');
