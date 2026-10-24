/**
 * 数据源定义与获取层。
 *
 * 设计约束（全部来自 2026-10-24 实测，见 docs/FINDINGS.md）：
 * 1. obsidian-releases 仓库无 LICENSE（raw 404 + GitHub license API 404）→ 本工具
 *    不在仓库内打包注册表快照，一律运行时拉取，只缓存到用户本机 localStorage。
 * 2. raw.githubusercontent.com 返回 Access-Control-Allow-Origin: *，浏览器可直连，
 *    因此无需自建代理。
 * 3. 该域名在受限网络下会间歇性连接失败（实测首轮 500 条中 257 条失败，重试后
 *    225 条恢复、0 条真 404）。所以网络失败必须标记为 UNKNOWN，绝不可当作 NOT_FOUND。
 */

export const REGISTRY_BASE =
  'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD';

/** 官方注册表与辅助清单。全部为公开只读 JSON，无需认证。 */
export const SOURCES = {
  registry: {
    id: 'registry',
    url: `${REGISTRY_BASE}/community-plugins.json`,
    label: '社区插件注册表',
    fields: ['id', 'name', 'author', 'description', 'repo'],
    note: '扁平数组。仅 5 个字段，不含版本、许可证、最低应用版本。',
  },
  stats: {
    id: 'stats',
    url: `${REGISTRY_BASE}/community-plugin-stats.json`,
    label: '下载统计',
    note: '以插件 id 为键；含 downloads、updated(ms) 与逐版本下载数。',
  },
  removed: {
    id: 'removed',
    url: `${REGISTRY_BASE}/community-plugins-removed.json`,
    label: '已下架清单',
    note: '含 id/name/reason/issue，是官方承认的失效来源。',
  },
  deprecation: {
    id: 'deprecation',
    url: `${REGISTRY_BASE}/community-plugin-deprecation.json`,
    label: '版本弃用清单',
    note: '插件 id → 被官方标记弃用的版本数组。',
  },
  desktop: {
    id: 'desktop',
    url: `${REGISTRY_BASE}/desktop-releases.json`,
    label: '客户端版本',
    note: '含 minimumVersion / latestVersion，用于兼容性判断的版本基线。',
  },
};

/** 单个插件 manifest 的地址。HEAD 指向默认分支，避免猜分支名。 */
export function manifestUrl(repo) {
  return `https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`;
}

/** versions.json：应用版本 → 兼容插件版本映射，仅部分插件提供。 */
export function versionsUrl(repo) {
  return `https://raw.githubusercontent.com/${repo}/HEAD/versions.json`;
}

/**
 * 许可证文件候选名。实测样本里出现过 LICENSE / LICENSE.txt / LICENSE.md /
 * COPYING，也有完全缺失的仓库，所以这里必须允许「找不到」。
 */
export const LICENSE_FILENAMES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'COPYING',
  'COPYING.md',
];

export function licenseUrl(repo, filename) {
  return `https://raw.githubusercontent.com/${repo}/HEAD/${filename}`;
}

/**
 * 带超时与重试的抓取。
 *
 * 关键点：fetch 在受限网络下会抛 TypeError / AbortError，这类错误**不是**
 * 资源不存在的证据。返回结构化结果而非抛异常，让上层能区分三态：
 *   ok      → 拿到了
 *   missing → 明确 404（服务端说没有）
 *   unknown → 网络层失败（超时、连接重置、DNS），结论不可用
 */
export async function fetchResource(url, opts = {}) {
  const {
    timeoutMs = 12000,
    retries = 2,
    backoffMs = 700,
    fetchImpl = globalThis.fetch,
    signal,
  } = opts;

  let last = { state: 'unknown', url, reason: 'not_attempted', attempts: 0 };

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
      const res = await fetchImpl(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'ext-audit/1.0 (metadata verifier)' },
        cache: 'no-store',
      });
      last = {
        state: res.status === 200 ? 'ok' : res.status === 404 ? 'missing' : 'unknown',
        status: res.status,
        url,
        attempts: attempt,
        body: null,
        reason: res.status === 200 || res.status === 404 ? null : `http_${res.status}`,
      };
      if (res.status === 200) {
        last.body = await res.text();
        last.fetchedAt = Date.now();
        return last;
      }
      // 404 是确定性结论，不重试。5xx / 429 属于暂时性，值得重试。
      if (res.status === 404) return last;
    } catch (err) {
      last = {
        state: 'unknown',
        url,
        attempts: attempt,
        reason: err?.name === 'AbortError' ? 'timeout' : `network_${err?.name || 'error'}`,
        body: null,
      };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }

    if (attempt <= retries) {
      await new Promise((r) => setTimeout(r, backoffMs * attempt));
    }
  }
  return last;
}

/** 抓取并解析 JSON，解析失败单独归类，避免与网络失败混淆。 */
export async function fetchJson(url, opts = {}) {
  const res = await fetchResource(url, opts);
  if (res.state !== 'ok') return res;
  try {
    return { ...res, data: JSON.parse(res.body), body: undefined };
  } catch (err) {
    return { ...res, state: 'invalid', reason: `json_parse:${err.message}`, body: undefined };
  }
}
