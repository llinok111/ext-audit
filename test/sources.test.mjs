/**
 * 抓取层测试。用注入的 fetch 模拟，验证三态判定：
 * ok / missing(404) / unknown(网络失败)，以及重试与 404 不重试的语义。
 */
import { test, assert, run } from './harness.mjs';
import { fetchResource, fetchJson, manifestUrl, licenseUrl, LICENSE_FILENAMES } from '../src/sources.mjs';

/** 构造按调用序列返回的假 fetch。 */
function scriptedFetch(steps) {
  let i = 0;
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, signal: init?.signal });
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step instanceof Error) throw step;
    if (step.status === 200) {
      return { status: 200, text: async () => step.body ?? '' };
    }
    return { status: step.status, text: async () => '' };
  };
  fn.calls = calls;
  return fn;
}

test('200 → ok 并带回 body 与时间戳', async () => {
  const f = scriptedFetch([{ status: 200, body: '{"a":1}' }]);
  const r = await fetchResource('http://x', { fetchImpl: f, retries: 0 });
  assert.equal(r.state, 'ok');
  assert.equal(r.body, '{"a":1}');
  assert.ok(r.fetchedAt > 0);
});

test('404 → missing，且不重试（确定性结论）', async () => {
  const f = scriptedFetch([{ status: 404 }]);
  const r = await fetchResource('http://x', { fetchImpl: f, retries: 3 });
  assert.equal(r.state, 'missing');
  assert.equal(f.calls.length, 1, '404 不应触发重试');
});

test('网络异常 → unknown，不是 missing', async () => {
  const f = scriptedFetch([new TypeError('fetch failed')]);
  const r = await fetchResource('http://x', { fetchImpl: f, retries: 0, timeoutMs: 1000 });
  assert.equal(r.state, 'unknown');
  assert.ok(r.reason.startsWith('network_'));
});

test('网络异常会按 retries 重试', async () => {
  const f = scriptedFetch([new TypeError('x')]);
  await fetchResource('http://x', { fetchImpl: f, retries: 2, backoffMs: 1, timeoutMs: 1000 });
  assert.equal(f.calls.length, 3);
});

test('首次网络失败、重试成功 → ok，attempts 记录真实次数', async () => {
  const f = scriptedFetch([new TypeError('x'), { status: 200, body: 'ok' }]);
  const r = await fetchResource('http://x', { fetchImpl: f, retries: 2, backoffMs: 1, timeoutMs: 1000 });
  assert.equal(r.state, 'ok');
  assert.equal(r.attempts, 2);
});

test('5xx → unknown 且会重试（暂时性错误）', async () => {
  const f = scriptedFetch([{ status: 503 }]);
  const r = await fetchResource('http://x', { fetchImpl: f, retries: 2, backoffMs: 1, timeoutMs: 1000 });
  assert.equal(r.state, 'unknown');
  assert.equal(f.calls.length, 3);
});

test('超时 → unknown 且 reason=timeout', async () => {
  const hang = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
  const r = await fetchResource('http://x', { fetchImpl: hang, retries: 0, timeoutMs: 40 });
  assert.equal(r.state, 'unknown');
  assert.equal(r.reason, 'timeout');
});

test('JSON 解析失败单独归类为 invalid，不与网络失败混淆', async () => {
  const f = scriptedFetch([{ status: 200, body: '{not json' }]);
  const r = await fetchJson('http://x', { fetchImpl: f, retries: 0 });
  assert.equal(r.state, 'invalid');
  assert.ok(r.reason.startsWith('json_parse'));
});

test('manifestUrl 使用 HEAD 而非猜分支名', () => {
  assert.ok(manifestUrl('a/b').includes('/HEAD/manifest.json'));
});

test('licenseUrl 与候选名列表一致', () => {
  assert.ok(LICENSE_FILENAMES.includes('LICENSE'));
  assert.ok(LICENSE_FILENAMES.includes('LICENSE.md'));
  assert.ok(licenseUrl('a/b', 'LICENSE.txt').endsWith('/HEAD/LICENSE.txt'));
});

test('外部 AbortSignal 可中止请求', async () => {
  const ctrl = new AbortController();
  const hang = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
  setTimeout(() => ctrl.abort(), 20);
  const r = await fetchResource('http://x', {
    fetchImpl: hang,
    retries: 0,
    timeoutMs: 5000,
    signal: ctrl.signal,
  });
  assert.equal(r.state, 'unknown');
});

await run();
