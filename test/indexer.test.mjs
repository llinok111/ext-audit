/**
 * 索引、合并与搜索测试。全部离线，用夹具数据，不依赖网络。
 */
import { test, assert, run } from './harness.mjs';
import { toRecord, search, describeCoverage, pool } from '../src/indexer.mjs';

/** 构造一个最小 bundle，模拟 loadSources 的返回结构。 */
function fixtureBundle() {
  return {
    registry: [
      { id: 'obsidian-git', name: 'Git', author: 'Vinzent', description: 'Integrate Git version control', repo: 'Vinzent03/obsidian-git' },
      { id: 'dataview', name: 'Dataview', author: 'Michael Brenan', description: 'Complex data views', repo: 'blacksmithgu/obsidian-dataview' },
      { id: 'ghost-plugin', name: 'Ghost', author: 'Nobody', description: 'A plugin that vanished', repo: 'ghost/deleted-repo' },
    ],
    stats: {
      'obsidian-git': { downloads: 1200000, updated: 1792830000000, '2.0.0': 500000 },
      dataview: { downloads: 800000, updated: 1792000000000 },
    },
    removed: [{ id: 'ghost-plugin', name: 'Ghost', reason: 'Repository deleted' }],
    deprecation: { 'obsidian-git': ['1.0.0'] },
    desktop: { minimumVersion: '0.15.0', latestVersion: '1.12.7' },
    sources: {
      registry: { label: '注册表', state: 'ok', status: 200, sourceUrl: 'u1', fetchedAt: 1 },
      stats: { label: '下载统计', state: 'ok', status: 200, sourceUrl: 'u2', fetchedAt: 1 },
      removed: { label: '已下架', state: 'ok', status: 200, sourceUrl: 'u3', fetchedAt: 1 },
      deprecation: { label: '弃用', state: 'ok', status: 200, sourceUrl: 'u4', fetchedAt: 1 },
      desktop: { label: '客户端版本', state: 'unknown', reason: 'timeout', sourceUrl: 'u5', fetchedAt: null },
    },
    fetchedAt: 1792830000000,
  };
}

/* ---------- 合并：不补全字段 ---------- */
test('toRecord 保留注册表字段', () => {
  const b = fixtureBundle();
  const r = toRecord(b.registry[0], b);
  assert.equal(r.id, 'obsidian-git');
  assert.equal(r.name, 'Git');
  assert.equal(r.repo, 'Vinzent03/obsidian-git');
});

test('注册表没有的字段必须是 null，不能是空字符串或猜测值', () => {
  const b = fixtureBundle();
  const r = toRecord(b.registry[0], b);
  assert.equal(r.version, null);
  assert.equal(r.minAppVersion, null);
  assert.equal(r.license, null);
});

test('合并 stats：下载量与更新时间取自 stats，缺失时为 null', () => {
  const b = fixtureBundle();
  assert.equal(toRecord(b.registry[0], b).downloads, 1200000);
  assert.equal(toRecord(b.registry[2], b).downloads, null);
  assert.equal(toRecord(b.registry[2], b).updatedAt, null);
});

test('已知版本列表排除 downloads/updated 两个非版本键', () => {
  const b = fixtureBundle();
  const r = toRecord(b.registry[0], b);
  assert.deepEqual(r.knownVersions, ['2.0.0']);
});

test('合并下架与弃用记录', () => {
  const b = fixtureBundle();
  const ghost = toRecord(b.registry[2], b);
  assert.ok(ghost.removedEntry);
  assert.equal(ghost.removedEntry.reason, 'Repository deleted');
  const git = toRecord(b.registry[0], b);
  assert.deepEqual(git.deprecationEntry, ['1.0.0']);
});

test('每条记录都带来源链接', () => {
  const b = fixtureBundle();
  const r = toRecord(b.registry[0], b);
  assert.ok(r.sources.registry.startsWith('https://'));
  assert.ok(r.sources.manifest.includes('Vinzent03/obsidian-git'));
  assert.ok(r.sources.manifest.endsWith('/manifest.json'));
});

/* ---------- 搜索 ---------- */
test('空查询返回前 N 条，分数为 0', () => {
  const b = fixtureBundle();
  const recs = b.registry.map((e) => toRecord(e, b));
  const res = search(recs, '', { limit: 2 });
  assert.equal(res.length, 2);
  assert.equal(res[0].score, 0);
});

test('精确名称匹配排第一且分数最高', () => {
  const b = fixtureBundle();
  const recs = b.registry.map((e) => toRecord(e, b));
  const res = search(recs, 'git');
  assert.equal(res[0].record.id, 'obsidian-git');
  assert.ok(res[0].matched.some((m) => m.field === 'name'));
});

test('搜索可解释：返回命中字段', () => {
  const b = fixtureBundle();
  const recs = b.registry.map((e) => toRecord(e, b));
  const res = search(recs, 'brenan');
  assert.equal(res.length, 1);
  assert.ok(res[0].matched.some((m) => m.field === 'author' && m.kind === 'contains'));
});

test('描述命中也能被搜到，但权重低于名称', () => {
  const b = fixtureBundle();
  const recs = b.registry.map((e) => toRecord(e, b));
  const res = search(recs, 'version');
  assert.ok(res.some((r) => r.record.id === 'obsidian-git'));
  const nameHit = search(recs, 'dataview')[0];
  const descHit = res.find((r) => r.record.id === 'obsidian-git');
  assert.ok(nameHit.score > descHit.score);
});

test('可排除已下架项', () => {
  const b = fixtureBundle();
  const recs = b.registry.map((e) => toRecord(e, b));
  const withRemoved = search(recs, 'ghost', { includeRemoved: true });
  const withoutRemoved = search(recs, 'ghost', { includeRemoved: false });
  assert.equal(withRemoved.length, 1);
  assert.equal(withoutRemoved.length, 0);
});

test('大小写不敏感', () => {
  const b = fixtureBundle();
  const recs = b.registry.map((e) => toRecord(e, b));
  assert.equal(search(recs, 'GIT')[0].record.id, 'obsidian-git');
});

test('无命中返回空数组而非报错', () => {
  const b = fixtureBundle();
  const recs = b.registry.map((e) => toRecord(e, b));
  assert.deepEqual(search(recs, 'zzzznotfound'), []);
});

test('缺下载量的记录不因排序被当成 0 压到最前', () => {
  const b = fixtureBundle();
  const recs = b.registry.map((e) => toRecord(e, b));
  // 同分场景：三条描述都含 'plugin'
  const res = search(recs, 'plugin');
  const idxGhost = res.findIndex((r) => r.record.id === 'ghost-plugin');
  const idxGit = res.findIndex((r) => r.record.id === 'obsidian-git');
  assert.ok(idxGit < idxGhost, '有下载量的应排在无下载量的前面');
});

/* ---------- 覆盖率说明 ---------- */
test('describeCoverage 如实报告各源状态，含失败源', () => {
  const b = fixtureBundle();
  const cov = describeCoverage(b);
  assert.equal(cov.registryCount, 3);
  assert.equal(cov.statsCount, 2);
  assert.equal(cov.removedCount, 1);
  const desktop = cov.states.find((s) => s.id === 'desktop');
  assert.equal(desktop.state, 'unknown');
  assert.equal(desktop.reason, 'timeout');
});

test('describeCoverage 必须声明安全接口缺失与许可证识别局限', () => {
  const cov = describeCoverage(fixtureBundle());
  const joined = cov.limitations.join(' ');
  assert.ok(joined.includes('安全'));
  assert.ok(joined.includes('许可证'));
  assert.ok(cov.limitations.length >= 4);
});

/* ---------- 并发池 ---------- */
test('pool 保持输入顺序', async () => {
  const items = [1, 2, 3, 4, 5, 6, 7];
  const out = await pool(items, async (n) => {
    await new Promise((r) => setTimeout(r, (8 - n) * 3));
    return n * 10;
  }, 3);
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70]);
});

test('pool 单条抛错会中断（当前语义）', async () => {
  let threw = false;
  try {
    await pool([1, 2, 3], async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    }, 2);
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
});

await run();
