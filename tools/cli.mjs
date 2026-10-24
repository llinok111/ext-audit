#!/usr/bin/env node
/**
 * CLI：扩展发现与核验。
 *
 * 用法：
 *   node tools/cli.mjs search <关键词> [--limit N] [--json]
 *   node tools/cli.mjs verify <插件id...> [--app 1.14.5] [--json]
 *   node tools/cli.mjs audit --sample N [--app 1.14.5] [--json]
 *   node tools/cli.mjs sources
 *
 * 退出码：0 全部 ok/warn；1 存在 fail；2 存在 unknown 且无 fail；3 运行错误
 */
import { loadSources, toRecord, verifyRecord, search, describeCoverage, pool } from '../src/indexer.mjs';
import { runChecks, summarize, checkCompatibility } from '../src/verify.mjs';
import { saveCache, cacheAgeHours } from '../src/cache.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const json = argv.includes('--json');
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : def;
};

const CACHE_DIR = flag('cache-dir', null);
const OFFLINE = argv.includes('--offline');
// 注册表 2.8 MB，受限网络下单次可达 40 秒，默认给足余量
const TIMEOUT = Number(flag('timeout', 45000));
const RETRIES = Number(flag('retries', 3));
const NET_OPTS = { timeoutMs: TIMEOUT, retries: RETRIES, cacheDir: CACHE_DIR, cacheOnly: OFFLINE };

/** 带值的选项名。这些选项后面那个 token 是值，不是位置参数。 */
const VALUE_FLAGS = new Set(['app', 'limit', 'sample', 'cache-dir', 'timeout', 'retries']);

/**
 * 取位置参数（排除所有选项及其值）。
 * 早期版本用 argv.slice(1) 直接把 --cache-dir 的值当成插件 id，
 * 导致「注册表中不存在：data/cache」这类误报（实测抓出）。
 */
function positionals() {
  const out = [];
  // 从索引 1 开始：argv[0] 是子命令名，不属于位置参数
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!name.includes('=') && VALUE_FLAGS.has(name)) i += 1; // 跳过值
      continue;
    }
    out.push(a);
  }
  return out;
}

function fmtMs(ms) {
  if (!ms) return '—';
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

function printRecord(v, appVersion) {
  const lic = v.license?.status === 'found'
    ? `${v.license.detection.spdx || v.license.detection.confidence} (${v.license.file})`
    : v.license?.status === 'missing'
      ? '未提供许可证文件'
      : `未确定（${v.license?.reason || '?'}）`;

  console.log(`\n${v.name || v.id}  [${v.status}]`);
  console.log(`  id            ${v.id}`);
  console.log(`  repo          ${v.repo}`);
  console.log(`  版本          ${v.version || '未取得'}  (minApp ${v.minAppVersion || '未声明'})`);
  console.log(`  你的版本      ${appVersion || '未提供'}`);
  console.log(`  许可证        ${lic}`);
  console.log(`  下载量        ${v.downloads ?? '无记录'}`);
  console.log(`  最近更新      ${fmtMs(v.updatedAt)}`);
  if (v.removedEntry) console.log(`  官方下架      是（${v.removedEntry.reason}）`);

  const compat = checkCompatibility({
    minAppVersion: v.minAppVersion,
    appVersion,
    versionsMap: v.versionsMap,
    pluginVersion: v.version,
  });
  console.log(`  兼容判定      ${compat.verdict} — ${compat.reason}`);

  console.log('  检查项：');
  for (const c of v.checks) {
    const tag = c.advisory ? '(常驻)' : '';
    console.log(`    [${c.level.padEnd(7)}] ${c.title} ${tag}`);
    console.log(`              ${c.detail}`);
  }
  console.log(`  来源：${v.sources.manifest}`);
  if (v.license?.url) console.log(`        ${v.license.url}`);
}

async function main() {
  if (!cmd || ['-h', '--help', 'help'].includes(cmd)) {
    console.log(`扩展发现与核验工具

命令：
  search <关键词>        在官方注册表中搜索
  verify <id...>         深度核验指定插件
  audit --sample N       随机抽样核验，给出整体分布
  sources                显示各数据源状态与局限
  cache --cache-dir DIR  拉取全部数据源并写入带溯源的本地缓存

选项：
  --app <版本>           你的 Obsidian 版本（默认 1.14.5）
  --limit N              搜索返回条数（默认 20）
  --sample N             抽样数量（默认 30）
  --cache-dir DIR        使用/写入缓存目录
  --offline              只读缓存，不发起网络请求
  --timeout MS           单请求超时（默认 45000）
  --retries N            重试次数（默认 3）
  --json                 输出 JSON

退出码：0 无异常 | 1 存在 fail | 2 存在 unknown | 3 运行错误
`);
    return 0;
  }

  const appVersion = flag('app', '1.14.5');

  if (cmd === 'cache') {
    if (!CACHE_DIR) { console.error('缺少 --cache-dir 参数'); return 3; }
    console.log(`拉取数据源（timeout=${TIMEOUT}ms retries=${RETRIES}）…`);
    const b = await loadSources(NET_OPTS);
    const meta = await saveCache(CACHE_DIR, b.sources);
    console.log(`已写入 ${CACHE_DIR}`);
    for (const [id, info] of Object.entries(meta.sources)) {
      console.log(`  ${id.padEnd(12)} ${String(info.bytes).padStart(9)} B  sha256=${info.sha256.slice(0, 12)}…`);
    }
    console.log(`注册表 ${b.registry.length} 条`);
    return 0;
  }

  if (cmd === 'sources') {
    const b = await loadSources(NET_OPTS);
    const cov = describeCoverage(b);
    if (json) { console.log(JSON.stringify(cov, null, 2)); return 0; }
    console.log(`拉取时间 ${fmtMs(cov.fetchedAt)}${cov.fromCache ? `（来自缓存，写入于 ${fmtMs(cov.cacheSavedAt)}）` : ''}`);
    console.log(`注册表 ${cov.registryCount} 条 | 统计 ${cov.statsCount} | 下架 ${cov.removedCount}`);
    console.log(`客户端版本 minimum=${cov.desktopMinimum} latest=${cov.desktopLatest}`);
    for (const s of cov.states) {
      console.log(`  [${s.state}] ${s.label}${s.fromCache ? '（缓存）' : ''}${s.reason ? ' — ' + s.reason : ''}`);
      console.log(`        ${s.url}`);
    }
    console.log('\n局限：');
    cov.limitations.forEach((l) => console.log(`  - ${l}`));
    return 0;
  }

  const bundle = await loadSources(NET_OPTS);

  if (cmd === 'search') {
    const pos = positionals();
    const q = pos[0];
    if (!q) { console.error('缺少关键词'); return 3; }
    const limit = Number(flag('limit', 20));
    const hits = search(bundle.registry.map((e) => toRecord(e, bundle)), q, { limit });
    if (json) { console.log(JSON.stringify(hits.map((h) => ({ ...h.record, score: h.score, matched: h.matched })), null, 2)); return 0; }
    console.log(`查询「${q}」→ ${hits.length} 条`);
    for (const { record, score, matched } of hits) {
      const lic = record.license ? record.license : '未核验';
      console.log(`  ${String(score).padStart(3)}  ${(record.name || '').padEnd(32)} ${record.repo}`);
      console.log(`       命中: ${matched.map((m) => m.field + ':' + m.kind).join(', ')}  | 下载 ${record.downloads ?? '—'}`);
    }
    return 0;
  }

  if (cmd === 'verify') {
    const ids = positionals();
    if (!ids.length) { console.error('缺少插件 id'); return 3; }
    const byId = new Map(bundle.registry.map((e) => [e.id, e]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) console.error(`注册表中不存在：${missing.join(', ')}`);

    const recs = ids.filter((id) => byId.has(id)).map((id) => toRecord(byId.get(id), bundle));
    const results = await pool(recs, async (r) => {
      const v = await verifyRecord(r, { timeoutMs: TIMEOUT, retries: RETRIES });
      const merged = { ...r, ...v };
      merged.checks = runChecks(merged, { appVersion });
      merged.status = summarize(merged.checks);
      return merged;
    }, 4);

    if (json) { console.log(JSON.stringify(results, null, 2)); }
    else results.forEach((v) => printRecord(v, appVersion));

    const hasFail = results.some((r) => r.status === 'fail');
    const hasUnknown = results.some((r) => r.status === 'unknown');
    return hasFail ? 1 : hasUnknown ? 2 : 0;
  }

  if (cmd === 'audit') {
    const n = Number(flag('sample', 30));
    let seed = 20261024;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const sample = [];
    while (sample.length < n) {
      const cand = bundle.registry[Math.floor(rnd() * bundle.registry.length)];
      if (cand && !sample.find((s) => s.id === cand.id)) sample.push(cand);
    }

    console.log(`抽样 ${n} 个插件核验（app=${appVersion}）…`);
    const results = await pool(sample, async (e) => {
      const r = toRecord(e, bundle);
      const v = await verifyRecord(r, { timeoutMs: TIMEOUT, retries: RETRIES });
      const merged = { ...r, ...v };
      merged.checks = runChecks(merged, { appVersion });
      merged.status = summarize(merged.checks);
      return merged;
    }, 4);

    const tally = {};
    results.forEach((r) => (tally[r.status] = (tally[r.status] || 0) + 1));
    const lic = {};
    results.forEach((r) => {
      const k = r.license?.status === 'found' ? (r.license.detection?.spdx || 'unrecognized') : r.license?.status || 'unknown';
      lic[k] = (lic[k] || 0) + 1;
    });

    if (json) {
      console.log(JSON.stringify({ appVersion, tally, licenses: lic, results: results.map((r) => ({ id: r.id, status: r.status, version: r.version, minAppVersion: r.minAppVersion, license: r.license?.detection?.spdx || r.license?.status, repoStatus: r.repoStatus })) }, null, 2));
    } else {
      console.log('\n状态分布:', JSON.stringify(tally));
      console.log('许可证分布:', JSON.stringify(lic));
      console.log('\n逐条：');
      results.forEach((r) => {
        const l = r.license?.status === 'found' ? (r.license.detection?.spdx || 'unrecognized') : (r.license?.status || '?');
        console.log(`  [${r.status.padEnd(7)}] ${r.id.padEnd(34)} v${String(r.version || '?').padEnd(9)} min=${String(r.minAppVersion || '?').padEnd(8)} ${l}`);
      });
      const failIds = results.filter((r) => r.status === 'fail').map((r) => r.id);
      const unkIds = results.filter((r) => r.status === 'unknown').map((r) => r.id);
      if (failIds.length) console.log(`\nfail: ${failIds.join(', ')}`);
      if (unkIds.length) console.log(`unknown（多为网络受限，非缺陷）: ${unkIds.join(', ')}`);
    }

    const hasFail = results.some((r) => r.status === 'fail');
    const hasUnknown = results.some((r) => r.status === 'unknown');
    return hasFail ? 1 : hasUnknown ? 2 : 0;
  }

  console.error(`未知命令：${cmd}`);
  return 3;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error('运行失败：', err.message);
    process.exitCode = 3;
  });
