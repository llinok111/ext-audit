/**
 * 缓存层测试。重点：缓存不得静默变成「无数据」，校验和必须生效，
 * 且缓存命中时所有源都要被解析成 data（此缺陷曾由离线实测抓出）。
 */
import { test, assert, run } from './harness.mjs';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveCache, loadCache, sha256 } from '../src/cache.mjs';
import { loadSources, describeCoverage } from '../src/indexer.mjs';
import { SOURCES } from '../src/sources.mjs';

async function makeTmp() {
  return await mkdtemp(path.join(tmpdir(), 'extaudit-'));
}

function fakeSources() {
  const mk = (url, obj) => ({
    state: 'ok',
    status: 200,
    body: JSON.stringify(obj),
    sourceUrl: url,
    fetchedAt: 1700000000000,
  });
  return {
    registry: mk(SOURCES.registry.url, [{ id: 'a', name: 'A', author: 'x', description: 'd', repo: 'x/y' }]),
    stats: mk(SOURCES.stats.url, { a: { downloads: 5, updated: 1700000000000 } }),
    removed: mk(SOURCES.removed.url, [{ id: 'b', reason: 'gone' }]),
    deprecation: mk(SOURCES.deprecation.url, { a: ['0.9.0'] }),
    desktop: mk(SOURCES.desktop.url, { minimumVersion: '1.0.0', latestVersion: '1.2.0' }),
  };
}

test('saveCache 写入全部源并记录 sha256 与来源', async () => {
  const dir = await makeTmp();
  try {
    const meta = await saveCache(dir, fakeSources());
    assert.equal(Object.keys(meta.sources).length, 5);
    for (const info of Object.values(meta.sources)) {
      assert.ok(info.sha256.length === 64);
      assert.ok(info.url.startsWith('https://'));
      assert.ok(info.bytes > 0);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('loadCache 能读回并保持 ok 状态', async () => {
  const dir = await makeTmp();
  try {
    await saveCache(dir, fakeSources());
    const { sources } = await loadCache(dir);
    assert.equal(Object.keys(sources).length, 5);
    for (const s of Object.values(sources)) {
      assert.equal(s.state, 'ok');
      assert.equal(s.fromCache, true);
      assert.equal(typeof s.body, 'string');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('校验和不匹配 → invalid，不当作可用数据', async () => {
  const dir = await makeTmp();
  try {
    await saveCache(dir, fakeSources());
    await writeFile(path.join(dir, 'registry.json'), '[{"tampered":true}]', 'utf8');
    const { sources } = await loadCache(dir);
    assert.equal(sources.registry.state, 'invalid');
    assert.equal(sources.registry.reason, 'cache_checksum_mismatch');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('离线模式下所有源都被解析成 data（回归：曾只解析 registry 导致其余全为 0）', async () => {
  const dir = await makeTmp();
  try {
    await saveCache(dir, fakeSources());
    const b = await loadSources({ cacheDir: dir, cacheOnly: true });
    assert.equal(b.registry.length, 1);
    assert.equal(Object.keys(b.stats).length, 1, 'stats 必须被解析');
    assert.equal(b.removed.length, 1, 'removed 必须被解析');
    assert.deepEqual(b.deprecation, { a: ['0.9.0'] }, 'deprecation 必须被解析');
    assert.equal(b.desktop.latestVersion, '1.2.0', 'desktop 必须被解析');
    assert.equal(b.fromCache, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('离线模式缺注册表时明确报错，不返回空索引', async () => {
  const dir = await makeTmp();
  try {
    await saveCache(dir, { registry: { state: 'unknown', sourceUrl: SOURCES.registry.url } });
    let msg = null;
    try {
      await loadSources({ cacheDir: dir, cacheOnly: true });
    } catch (e) { msg = e.message; }
    assert.ok(msg, '应当抛错');
    assert.ok(msg.includes('缓存'), `错误信息应提到缓存，实际：${msg}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('缓存年龄进入局限说明', async () => {
  const dir = await makeTmp();
  try {
    await saveCache(dir, fakeSources());
    const b = await loadSources({ cacheDir: dir, cacheOnly: true });
    const cov = describeCoverage(b);
    assert.equal(cov.fromCache, true);
    assert.ok(cov.limitations[0].includes('本地缓存'), '首条局限必须提示使用了缓存');
    assert.ok(cov.limitations.length >= 6);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('sha256 稳定且区分内容', () => {
  assert.equal(sha256('abc'), sha256('abc'));
  assert.notEqual(sha256('abc'), sha256('abd'));
  assert.equal(sha256('abc').length, 64);
});

await run();
