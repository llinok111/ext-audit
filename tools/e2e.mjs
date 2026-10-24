/**
 * 端到端真实网络验证。会真实访问 raw.githubusercontent.com。
 * 用途：证明工具在真实数据上可用，而不只是夹具通过。
 * 运行：node tools/e2e.mjs [--plugins N]
 */
import { loadSources, toRecord, verifyRecord, search, describeCoverage, pool } from '../src/indexer.mjs';
import { runChecks, summarize, checkCompatibility } from '../src/verify.mjs';
import { writeFile, mkdir } from 'node:fs/promises';

const argN = process.argv.indexOf('--plugins');
const N = argN > -1 ? Number(process.argv[argN + 1]) || 6 : 6;

console.log('=== 1. 拉取官方数据源 ===');
const bundle = await loadSources({ timeoutMs: 20000, retries: 2 });
const cov = describeCoverage(bundle);
console.log(`注册表 ${cov.registryCount} 条 | 下载统计 ${cov.statsCount} 条 | 已下架 ${cov.removedCount} 条`);
console.log(`客户端版本基线: minimum=${cov.desktopMinimum} latest=${cov.desktopLatest}`);
for (const s of cov.states) {
  console.log(`  [${s.state.padEnd(7)}] ${s.label}  ${s.reason ? '(' + s.reason + ')' : ''}`);
}

console.log('\n=== 2. 搜索验证 ===');
for (const q of ['git', 'calendar', 'excalidraw']) {
  const hits = search(bundle.registry.map((e) => toRecord(e, bundle)), q, { limit: 3 });
  console.log(`  "${q}" → ${hits.map((h) => `${h.record.name}(${h.score})`).join(', ')}`);
}

console.log(`\n=== 3. 深度核验 ${N} 个真实插件 ===`);
// 选一批知名插件 + 一批随机插件，覆盖有/无许可证、有/无 versions.json
const famous = ['obsidian-git', 'dataview', 'templater-obsidian', 'obsidian-excalidraw-plugin', 'obsidian-style-settings', 'calendar'];
const byId = new Map(bundle.registry.map((e) => [e.id, e]));
const picked = famous.map((id) => byId.get(id)).filter(Boolean);

// 补充随机抽样，确保覆盖到「无许可证」这类真实情况
let seed = 20261024;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
while (picked.length < N) {
  const cand = bundle.registry[Math.floor(rnd() * bundle.registry.length)];
  if (cand && !picked.find((p) => p.id === cand.id)) picked.push(cand);
}

const base = picked.map((e) => toRecord(e, bundle));
const verified = await pool(
  base,
  async (rec) => {
    const v = await verifyRecord(rec, { timeoutMs: 20000, retries: 2 });
    const checks = runChecks(v, { appVersion: cov.desktopLatest });
    const compat = checkCompatibility({
      minAppVersion: v.minAppVersion,
      appVersion: cov.desktopLatest,
      versionsMap: v.versionsMap,
      pluginVersion: v.version,
    });
    return { ...v, checks, status: summarize(checks), compat };
  },
  3,
);

for (const v of verified) {
  const lic = v.license?.status === 'found'
    ? `${v.license.detection.spdx || v.license.detection.confidence}(${v.license.file})`
    : v.license?.status || '?';
  console.log(
    `  ${String(v.status).padEnd(7)} ${v.id.padEnd(32)} v${String(v.version || '?').padEnd(9)} min=${String(v.minAppVersion || '?').padEnd(8)} lic=${lic.padEnd(24)} compat=${v.compat.verdict}`,
  );
}

console.log('\n=== 4. 逐项检查明细（首个） ===');
for (const c of verified[0].checks) {
  console.log(`  [${c.level.padEnd(7)}] ${c.title} — ${c.detail}`);
}

// 统计
const tally = {};
verified.forEach((v) => (tally[v.status] = (tally[v.status] || 0) + 1));
console.log('\n状态分布:', JSON.stringify(tally));
const unknownCount = verified.filter((v) => v.status === 'unknown').length;
console.log(`未确定 ${unknownCount} / ${verified.length}（网络受限时属预期，非工具缺陷）`);

// 落盘证据
await mkdir('data/e2e', { recursive: true });
const evidence = {
  generatedAt: new Date().toISOString(),
  coverage: cov,
  records: verified.map((v) => ({
    id: v.id,
    repo: v.repo,
    version: v.version,
    minAppVersion: v.minAppVersion,
    license: v.license
      ? { status: v.license.status, file: v.license.file || null, spdx: v.license.detection?.spdx || null, url: v.license.url || null }
      : null,
    repoStatus: v.repoStatus,
    status: v.status,
    compat: v.compat,
    checks: v.checks,
    sources: v.sources,
  })),
};
await writeFile('data/e2e/run.json', JSON.stringify(evidence, null, 2));
console.log('\n证据已写入 data/e2e/run.json');
