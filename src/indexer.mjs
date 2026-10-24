/**
 * 索引构建与搜索。
 *
 * 职责：把 5 个独立数据源合并成统一记录，并提供可解释的搜索。
 * 纪律：合并时**不填充**缺失字段，缺就是 null，让界面如实显示。
 */

import {
  SOURCES,
  fetchJson,
  manifestUrl,
  versionsUrl,
  licenseUrl,
  LICENSE_FILENAMES,
  fetchResource,
} from './sources.mjs';
import { detectLicense } from './license.mjs';
import { loadCache } from './cache.mjs';

/** 简单并发池，避免对 raw.githubusercontent.com 打出过多并发连接。 */
export async function pool(items, worker, concurrency = 6) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * 拉取全部基础数据源。
 * 每个源单独记录状态与时间戳，某个源失败不影响其它源可用。
 *
 * opts.cacheDir 存在时：先用缓存（带 sha256 校验），缓存缺失/失配的源再走网络。
 * opts.cacheOnly 为真时：只读缓存，不发起任何网络请求（离线模式）。
 */
export async function loadSources(opts = {}) {
  const startedAt = Date.now();
  const { cacheOnly = false, cacheDir = null } = opts;

  let cached = null;
  if (cacheDir) {
    try {
      cached = await loadCache(cacheDir);
    } catch {
      cached = null; // 缓存不存在或损坏，静默回退到网络
    }
  }

  const entries = await Promise.all(
    Object.values(SOURCES).map(async (src) => {
      const hit = cached?.sources?.[src.id];
      if (hit && hit.state === 'ok') {
        return [
          src.id,
          { ...hit, label: src.label, sourceUrl: src.url, note: src.note },
        ];
      }
      if (cacheOnly) {
        return [
          src.id,
          {
            state: 'missing',
            reason: hit?.reason || 'not_in_cache',
            label: src.label,
            sourceUrl: src.url,
            note: src.note,
            body: null,
          },
        ];
      }
      const res = await fetchJson(src.url, opts);
      return [src.id, { ...res, label: src.label, sourceUrl: src.url, note: src.note }];
    }),
  );

  const sources = Object.fromEntries(entries);

  // 缓存命中时对象里只有 body 字符串，没有 data；这里统一补解析，
  // 否则会出现「5 个源都显示 ok，但统计/下架/版本全为 0」的静默错误
  // （此缺陷由离线模式实测抓出）。
  for (const s of Object.values(sources)) {
    if (s.state === 'ok' && s.data === undefined && typeof s.body === 'string') {
      try {
        s.data = JSON.parse(s.body);
      } catch (err) {
        s.state = 'invalid';
        s.reason = `json_parse:${err.message}`;
      }
    }
  }

  const finalRegistry = sources.registry?.data;

  if (!Array.isArray(finalRegistry)) {
    const reason =
      sources.registry?.state === 'unknown'
        ? `注册表抓取失败（${sources.registry.reason}）`
        : sources.registry?.reason === 'not_in_cache'
          ? '离线模式下缓存中缺少注册表'
          : `注册表内容异常（state=${sources.registry?.state}）`;
    const err = new Error(reason);
    err.sources = sources;
    throw err;
  }

  return {
    sources,
    registry: finalRegistry,
    stats: sources.stats?.data && typeof sources.stats.data === 'object' ? sources.stats.data : {},
    removed: Array.isArray(sources.removed?.data) ? sources.removed.data : [],
    deprecation:
      sources.deprecation?.data && typeof sources.deprecation.data === 'object'
        ? sources.deprecation.data
        : {},
    desktop:
      sources.desktop?.data && typeof sources.desktop.data === 'object' ? sources.desktop.data : {},
    fetchedAt: startedAt,
    fromCache: Boolean(cached),
    cacheSavedAt: cached?.meta?.savedAt ?? null,
  };
}

/** 把原始注册表条目转成统一记录。不做任何字段补全。 */
export function toRecord(entry, bundle) {
  const stats = bundle.stats[entry.id] || null;
  const versions = stats
    ? Object.keys(stats).filter((k) => k !== 'downloads' && k !== 'updated')
    : [];

  return {
    id: entry.id ?? null,
    name: entry.name ?? null,
    author: entry.author ?? null,
    description: entry.description ?? null,
    repo: entry.repo ?? null,
    // 以下字段在注册表中并不存在，必须为 null 而非猜测
    version: null,
    minAppVersion: null,
    license: null,
    downloads: stats?.downloads ?? null,
    updatedAt: stats?.updated ?? null,
    knownVersions: versions,
    removedEntry: bundle.removed.find((r) => r.id === entry.id) || null,
    deprecationEntry: bundle.deprecation[entry.id] || null,
    repoStatus: 'unchecked',
    sources: {
      registry: SOURCES.registry.url,
      stats: SOURCES.stats.url,
      manifest: entry.repo ? manifestUrl(entry.repo) : null,
    },
  };
}

/**
 * 深度核验单个插件：拉 manifest、versions.json、许可证文件。
 * 返回的新记录里每个字段都带来源链接，便于界面回溯。
 */
export async function verifyRecord(record, opts = {}) {
  if (!record.repo) {
    return {
      ...record,
      repoStatus: 'missing',
      repoStatusReason: '注册表未提供 repo 字段',
      checksReady: true,
    };
  }

  const manifestRes = await fetchResource(manifestUrl(record.repo), opts);
  let manifest = null;
  let manifestError = null;

  if (manifestRes.state === 'ok') {
    try {
      manifest = JSON.parse(manifestRes.body);
    } catch (err) {
      manifestError = `manifest JSON 解析失败：${err.message}`;
    }
  }

  // versions.json 缺失是常态（实测样本约半数没有），404 不是错误
  const versionsRes = await fetchResource(versionsUrl(record.repo), opts);
  let versionsMap = null;
  if (versionsRes.state === 'ok') {
    try {
      versionsMap = JSON.parse(versionsRes.body);
    } catch {
      versionsMap = null;
    }
  }

  // 许可证：逐个候选名试探，第一个 200 即为准
  let license = { status: 'unknown', tried: [], reason: 'not_attempted' };
  const tried = [];
  for (const filename of LICENSE_FILENAMES) {
    tried.push(filename);
    const res = await fetchResource(licenseUrl(record.repo, filename), {
      ...opts,
      retries: 1,
    });
    if (res.state === 'ok') {
      license = {
        status: 'found',
        file: filename,
        url: licenseUrl(record.repo, filename),
        text: res.body.slice(0, 8000),
        detection: detectLicense(res.body),
        tried,
        fetchedAt: res.fetchedAt,
      };
      break;
    }
    if (res.state === 'unknown') {
      // 网络不确定：不能继续断言「没有许可证」，停下来标记未知
      license = {
        status: 'unknown',
        tried,
        reason: res.reason,
        url: licenseUrl(record.repo, filename),
      };
      break;
    }
  }
  if (license.status === 'unknown' && license.reason === 'not_attempted') {
    // 全部候选都明确 404
    license = { status: 'missing', tried, reason: 'all_candidates_404' };
  } else if (license.status !== 'found' && license.status !== 'unknown') {
    license = { status: 'missing', tried, reason: 'all_candidates_404' };
  }

  return {
    ...record,
    manifest,
    manifestError,
    versionsMap,
    license,
    version: manifest?.version ?? null,
    minAppVersion: manifest?.minAppVersion ?? null,
    authorUrl: manifest?.authorUrl ?? null,
    isDesktopOnly: manifest?.isDesktopOnly ?? null,
    fundingUrl: manifest?.fundingUrl ?? null,
    repoStatus: manifestRes.state,
    repoStatusReason: manifestRes.reason || null,
    fetchedAt: Date.now(),
    sources: {
      ...record.sources,
      license: license.url || null,
      versions: versionsUrl(record.repo),
    },
  };
}

/**
 * 搜索。可解释：返回每条命中命中的字段与位置，而不是黑盒打分。
 * 排序权重：名称完全匹配 > 名称前缀 > 名称包含 > 作者 > 描述。
 */
export function search(records, query, options = {}) {
  const { limit = 50, includeRemoved = true, licenseFilter = null, minAppVersion = null } = options;
  const q = (query || '').trim().toLowerCase();

  let pool = records;
  if (!includeRemoved) pool = pool.filter((r) => !r.removedEntry);
  if (licenseFilter) {
    pool = pool.filter((r) => {
      if (licenseFilter === 'unknown') return !r.license || r.license.status !== 'found' || !r.license.detection?.spdx;
      return r.license?.detection?.spdx === licenseFilter;
    });
  }

  if (!q) {
    return pool.slice(0, limit).map((r) => ({ record: r, score: 0, matched: [] }));
  }

  const scored = [];
  for (const r of pool) {
    const matched = [];
    let score = 0;
    const name = (r.name || '').toLowerCase();
    const id = (r.id || '').toLowerCase();
    const author = (r.author || '').toLowerCase();
    const desc = (r.description || '').toLowerCase();
    const repo = (r.repo || '').toLowerCase();

    if (name === q || id === q) {
      score += 100;
      matched.push({ field: 'name', kind: 'exact' });
    } else if (name.startsWith(q) || id.startsWith(q)) {
      score += 60;
      matched.push({ field: 'name', kind: 'prefix' });
    } else if (name.includes(q) || id.includes(q)) {
      score += 35;
      matched.push({ field: 'name', kind: 'contains' });
    }
    if (author.includes(q)) {
      score += 15;
      matched.push({ field: 'author', kind: 'contains' });
    }
    if (desc.includes(q)) {
      score += 8;
      matched.push({ field: 'description', kind: 'contains' });
    }
    if (repo.includes(q)) {
      score += 5;
      matched.push({ field: 'repo', kind: 'contains' });
    }
    if (score > 0) scored.push({ record: r, score, matched });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // 同分时下载量高者优先，但缺失下载量不参与排序（避免把 null 当 0 压到末尾）
    const da = a.record.downloads ?? -1;
    const db = b.record.downloads ?? -1;
    if (db !== da) return db - da;
    return (a.record.name || '').localeCompare(b.record.name || '');
  });

  return scored.slice(0, limit);
}

/** 数据新鲜度与局限说明，界面必须展示。 */
export function describeCoverage(bundle) {
  const states = Object.entries(bundle.sources).map(([id, s]) => ({
    id,
    label: s.label,
    state: s.state,
    status: s.status ?? null,
    reason: s.reason ?? null,
    url: s.sourceUrl,
    fetchedAt: s.fetchedAt ?? null,
    fromCache: Boolean(s.fromCache),
  }));

  const registryCount = bundle.registry.length;
  const statsCount = Object.keys(bundle.stats).length;
  const removedCount = bundle.removed.length;

  const limitations = [
    '注册表本身不含版本、许可证与最低应用版本；这些字段仅在深度核验后才有值，未核验时显示为「未核验」而非空字符串。',
    '该生态不存在公开的安全审计或评分接口，本工具不提供「安全」结论，只提供可观测事实。',
    '下载统计与最近更新时间来自官方 stats 文件，其更新频率由上游决定，不代表当前时刻的真实值。',
    '许可证识别基于原文文本特征匹配，不是法律意见；冲突或无法识别时保留为未知。',
    '网络受限时 raw.githubusercontent.com 会间歇性连接失败，此时结论标记为「未确定」，不可当作失效。',
  ];

  if (bundle.fromCache) {
    const ageH = bundle.cacheSavedAt ? (Date.now() - bundle.cacheSavedAt) / 3600000 : null;
    limitations.unshift(
      `本次使用了本地缓存，缓存写入于 ${new Date(bundle.cacheSavedAt).toISOString()}（约 ${ageH === null ? '?' : ageH.toFixed(1)} 小时前）；注册表内容可能已落后于上游。`,
    );
  }

  return {
    fetchedAt: bundle.fetchedAt,
    fromCache: Boolean(bundle.fromCache),
    cacheSavedAt: bundle.cacheSavedAt ?? null,
    registryCount,
    statsCount,
    removedCount,
    desktopMinimum: bundle.desktop?.minimumVersion ?? null,
    desktopLatest: bundle.desktop?.latestVersion ?? null,
    states,
    limitations,
  };
}
