/**
 * 版本与检查逻辑测试。
 * 覆盖需求点：失效链接、缺少元数据、不兼容版本。
 */
import { test, assert, run } from './harness.mjs';
import {
  parseVersion,
  compareVersions,
  checkCompatibility,
  resolveFallbackVersion,
  runChecks,
  summarize,
} from '../src/verify.mjs';

/* ---------- 版本解析与比较 ---------- */
test('解析标准 semver', () => {
  const v = parseVersion('1.12.7');
  assert.equal(v.major, 1);
  assert.equal(v.minor, 12);
  assert.equal(v.patch, 7);
  assert.equal(v.precision, 3);
});

test('解析两段/一段版本，precision 正确', () => {
  assert.equal(parseVersion('1.4').precision, 2);
  assert.equal(parseVersion('1').precision, 1);
  assert.equal(parseVersion('v2.0.1').major, 2);
});

test('不可解析输入返回 null', () => {
  assert.equal(parseVersion('latest'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(null), null);
  assert.equal(parseVersion('1.x.0'), null);
});

test('版本比较正确', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
});

test('预发布版本低于同号正式版', () => {
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-beta'), 1);
});

/* ---------- 兼容性：三态判定 ---------- */
test('应用版本足够 → compatible', () => {
  const r = checkCompatibility({ minAppVersion: '1.5.0', appVersion: '1.12.7' });
  assert.equal(r.verdict, 'compatible');
  assert.ok(r.reason.includes('1.12.7'));
});

test('应用版本不足且无回退 → incompatible', () => {
  const r = checkCompatibility({ minAppVersion: '1.13.0', appVersion: '1.8.0' });
  assert.equal(r.verdict, 'incompatible');
  assert.equal(r.hasFallback, false);
});

test('应用版本不足但有 versions.json 回退 → incompatible 且标注回退版本', () => {
  const versionsMap = { '1.4.0': '2.1.0', '1.5.0': '2.2.0', '1.8.0': '2.5.0' };
  const r = checkCompatibility({
    minAppVersion: '1.13.0',
    appVersion: '1.8.0',
    versionsMap,
    pluginVersion: '3.0.0',
  });
  assert.equal(r.verdict, 'incompatible');
  assert.equal(r.hasFallback, true);
  assert.equal(r.basis.fallbackVersion, '2.5.0');
});

test('未提供应用版本 → undetermined，不默认兼容', () => {
  const r = checkCompatibility({ minAppVersion: '1.5.0', appVersion: null });
  assert.equal(r.verdict, 'undetermined');
});

test('manifest 未声明 minAppVersion → undetermined', () => {
  const r = checkCompatibility({ minAppVersion: null, appVersion: '1.12.7' });
  assert.equal(r.verdict, 'undetermined');
  assert.ok(r.reason.includes('minAppVersion'));
});

test('minAppVersion 不可解析 → undetermined', () => {
  const r = checkCompatibility({ minAppVersion: 'next', appVersion: '1.12.7' });
  assert.equal(r.verdict, 'undetermined');
});

test('resolveFallbackVersion 取不超过应用版本的最高项', () => {
  const map = { '1.0.0': '1.0.0', '1.5.0': '2.0.0', '2.0.0': '3.0.0' };
  assert.equal(resolveFallbackVersion(map, '1.6.0'), '2.0.0');
  assert.equal(resolveFallbackVersion(map, '0.9.0'), null);
});

/* ---------- 检查项：失效链接 ---------- */
test('仓库 404 → fail，且明确说明是 404 而非网络问题', () => {
  const checks = runChecks({ repoStatus: 'missing', manifest: null });
  const c = checks.find((x) => x.id === 'repo-reachable');
  assert.equal(c.level, 'fail');
  assert.ok(c.detail.includes('404'));
  assert.equal(summarize(checks), 'fail');
});

test('网络失败 → unknown，绝不判为 fail', () => {
  const checks = runChecks({ repoStatus: 'unknown', repoStatusReason: 'timeout', manifest: null });
  const c = checks.find((x) => x.id === 'repo-reachable');
  assert.equal(c.level, 'unknown');
  assert.ok(c.detail.includes('timeout'));
  assert.equal(summarize(checks), 'unknown');
});

test('网络失败不会产出任何 fail 级结论', () => {
  const checks = runChecks({ repoStatus: 'unknown', repoStatusReason: 'network_TypeError' });
  assert.equal(checks.some((c) => c.level === 'fail'), false);
});

/* ---------- 检查项：缺少元数据 ---------- */
test('注册表缺 description/author → warn 且列出字段', () => {
  const checks = runChecks({ repoStatus: 'ok', manifest: { id: 'a', name: 'a', version: '1.0.0', minAppVersion: '1.0.0', author: 'x' }, description: null, author: null, repo: 'a/b' });
  const c = checks.find((x) => x.id === 'registry-meta');
  assert.equal(c.level, 'warn');
  assert.deepEqual(c.basis, ['description', 'author']);
});

test('manifest 缺必填字段 → warn', () => {
  const checks = runChecks({ repoStatus: 'ok', manifest: { id: 'a', name: 'a' } });
  const c = checks.find((x) => x.id === 'manifest-complete');
  assert.equal(c.level, 'warn');
  assert.ok(c.basis.includes('version'));
  assert.ok(c.basis.includes('minAppVersion'));
});

test('manifest.id 与注册表 id 不一致 → fail', () => {
  const checks = runChecks({
    id: 'registry-id',
    repoStatus: 'ok',
    manifest: { id: 'other-id', name: 'a', version: '1.0.0', minAppVersion: '1.0.0', author: 'x' },
  });
  const c = checks.find((x) => x.id === 'manifest-id-match');
  assert.equal(c.level, 'fail');
});

test('未核验记录（repoStatus=unchecked）不会被静默跳过', () => {
  const checks = runChecks({ repoStatus: 'unchecked' });
  const c = checks.find((x) => x.id === 'repo-reachable');
  assert.ok(c, 'unchecked 状态必须产出一项检查');
  assert.equal(c.level, 'unknown');
});

test('最近更新检查读取 updatedAt（回归：曾误取 record.stats.updated 导致从不触发）', () => {
  const updatedAt = Date.now() - 10 * 86400000;
  const checks = runChecks({
    repoStatus: 'ok',
    manifest: { id: 'a', name: 'a', version: '1.0.0', minAppVersion: '1.0.0', author: 'x' },
    updatedAt,
  });
  const c = checks.find((x) => x.id === 'last-update');
  assert.ok(c, 'last-update 检查缺失');
  assert.equal(c.level, 'info');
  assert.ok(c.title.includes('10 天前'));
});

test('超过两年未更新 → warn', () => {
  const checks = runChecks({
    repoStatus: 'ok',
    manifest: { id: 'a', name: 'a', version: '1.0.0', minAppVersion: '1.0.0', author: 'x' },
    updatedAt: Date.now() - 800 * 86400000,
  });
  assert.equal(checks.find((x) => x.id === 'last-update').level, 'warn');
});


test('许可证文件缺失 → warn，不判为 fail', () => {
  const checks = runChecks({
    repoStatus: 'ok',
    manifest: { id: 'a', name: 'a', version: '1.0.0', minAppVersion: '1.0.0', author: 'x' },
    license: { status: 'missing', tried: ['LICENSE', 'LICENSE.md'] },
  });
  const c = checks.find((x) => x.id === 'license-declared');
  assert.equal(c.level, 'warn');
  assert.ok(c.detail.includes('LICENSE'));
});

test('许可证抓取网络失败 → unknown，不判为「无许可证」', () => {
  const checks = runChecks({
    repoStatus: 'ok',
    manifest: { id: 'a', name: 'a', version: '1.0.0', minAppVersion: '1.0.0', author: 'x' },
    license: { status: 'unknown', reason: 'timeout' },
  });
  const c = checks.find((x) => x.id === 'license-declared');
  assert.equal(c.level, 'unknown');
  assert.ok(!c.title.includes('未提供'));
});

test('安全基线项必须存在、为 unknown，且标记 advisory', () => {
  const checks = runChecks({ repoStatus: 'ok' });
  const c = checks.find((x) => x.id === 'security-baseline');
  assert.ok(c, '缺少安全基线声明项');
  assert.equal(c.level, 'unknown');
  assert.equal(c.advisory, true);
  assert.ok(c.detail.includes('不做代码审计'));
});

test('常驻能力边界声明不影响整体状态（否则全部插件恒为 unknown）', () => {
  const checks = runChecks({
    repoStatus: 'ok',
    manifest: { id: 'a', name: 'a', version: '1.0.0', minAppVersion: '1.0.0', author: 'x' },
    description: 'd',
    author: 'x',
    repo: 'a/b',
    license: { status: 'found', file: 'LICENSE', detection: { confidence: 'matched', spdx: 'MIT', note: 'ok' } },
  });
  // 该记录本身无任何问题，应判为 ok，而不是被 security-baseline 拖成 unknown
  assert.equal(summarize(checks), 'ok');
});

test('warn 单独成档，不并入 ok', () => {
  const checks = [
    { level: 'info', advisory: false },
    { level: 'warn', advisory: false },
  ];
  assert.equal(summarize(checks), 'warn');
});

test('官方下架 → fail 并带原因', () => {
  const checks = runChecks({ repoStatus: 'ok', removedEntry: { reason: 'Repository archived' } });
  const c = checks.find((x) => x.id === 'official-removed');
  assert.equal(c.level, 'fail');
  assert.ok(c.detail.includes('archived'));
});

test('当前版本被官方弃用 → fail', () => {
  const checks = runChecks({
    repoStatus: 'ok',
    manifest: { id: 'a', name: 'a', version: '1.0.2', minAppVersion: '1.0.0', author: 'x' },
    deprecationEntry: ['1.0.1', '1.0.2'],
  });
  const c = checks.find((x) => x.id === 'deprecated-version');
  assert.equal(c.level, 'fail');
});

test('兼容性必须进入状态汇总：不兼容 → fail', () => {
  const checks = runChecks(
    {
      repoStatus: 'ok',
      manifest: { id: 'a', name: 'a', version: '3.0.0', minAppVersion: '1.20.0', author: 'x' },
      minAppVersion: '1.20.0',
      version: '3.0.0',
      description: 'd',
      author: 'x',
      repo: 'a/b',
      license: { status: 'found', file: 'LICENSE', detection: { confidence: 'matched', spdx: 'MIT', note: 'ok' } },
    },
    { appVersion: '1.14.5' },
  );
  const c = checks.find((x) => x.id === 'version-compat');
  assert.ok(c, '缺少 version-compat 检查项');
  assert.equal(c.level, 'fail');
  assert.equal(summarize(checks), 'fail', '不兼容时整体状态必须是 fail');
});

test('兼容 → info，不污染整体状态', () => {
  const checks = runChecks(
    {
      repoStatus: 'ok',
      manifest: { id: 'a', name: 'a', version: '1.0.0', minAppVersion: '1.0.0', author: 'x' },
      minAppVersion: '1.0.0',
      version: '1.0.0',
      description: 'd',
      author: 'x',
      repo: 'a/b',
      license: { status: 'found', file: 'LICENSE', detection: { confidence: 'matched', spdx: 'MIT', note: 'ok' } },
    },
    { appVersion: '1.14.5' },
  );
  assert.equal(checks.find((x) => x.id === 'version-compat').level, 'info');
  assert.equal(summarize(checks), 'ok');
});

test('未提供应用版本时不产出兼容检查项（不作推断）', () => {
  const checks = runChecks({ repoStatus: 'ok', minAppVersion: '1.20.0', version: '3.0.0' });
  assert.equal(checks.find((x) => x.id === 'version-compat'), undefined);
});

/* ---------- 汇总 ---------- */
test('summarize 优先级：fail > unknown > warn > ok', () => {
  assert.equal(summarize([{ level: 'info', advisory: false }]), 'ok');
  assert.equal(summarize([{ level: 'info', advisory: false }, { level: 'warn', advisory: false }]), 'warn');
  assert.equal(summarize([{ level: 'warn', advisory: false }, { level: 'unknown', advisory: false }]), 'unknown');
  assert.equal(summarize([{ level: 'unknown', advisory: false }, { level: 'fail', advisory: false }]), 'fail');
});

test('advisory 项被完全排除在汇总之外', () => {
  const checks = [
    { level: 'info', advisory: false },
    { level: 'unknown', advisory: true },
    { level: 'fail', advisory: true },
  ];
  assert.equal(summarize(checks), 'ok');
});

await run();
