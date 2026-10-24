/**
 * 版本比较、兼容性判定与基础检查。
 *
 * 核心纪律：
 * - 兼容性只有三种结论：compatible / incompatible / undetermined。
 *   「不知道用户装的是哪个版本」时必须是 undetermined，不能默认 compatible。
 * - 检查项只陈述**可观测事实**，不产出「安全」结论。安全检查的缺失（例如没有
 *   官方安全评分接口）本身要作为一条 finding 呈现。
 */

/**
 * 解析 semver 宽松形式（允许 1.2、1.2.3-beta、v1.2.3）。
 * 严格性要求：必须整串匹配，不能只吃前缀。否则 "1.x.0" 会被误读成 "1.0.0"，
 * 进而污染兼容性判断（实测该缺陷由单元测试抓出）。
 */
export function parseVersion(input) {
  if (typeof input !== 'string') return null;
  const m = input
    .trim()
    .match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: m[2] === undefined ? 0 : Number(m[2]),
    patch: m[3] === undefined ? 0 : Number(m[3]),
    pre: m[4] || null,
    raw: input.trim(),
    // 段数决定「精确度」：1.2 只知道到 minor，1 只知道到 major
    precision: m[3] !== undefined ? 3 : m[2] !== undefined ? 2 : 1,
  };
}

/** 比较两个版本。a<b 返回 -1，相等 0，a>b 返回 1；任一方不可解析返回 null。 */
export function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return null;
  for (const k of ['major', 'minor', 'patch']) {
    if (va[k] !== vb[k]) return va[k] < vb[k] ? -1 : 1;
  }
  // 预发布版本低于同号正式版
  if (va.pre && !vb.pre) return -1;
  if (!va.pre && vb.pre) return 1;
  if (va.pre && vb.pre) return va.pre < vb.pre ? -1 : va.pre > vb.pre ? 1 : 0;
  return 0;
}

/**
 * 判断插件是否能装在给定 Obsidian 版本上。
 *
 * @param {object} p
 * @param {string|null} p.minAppVersion  插件 manifest 声明的最低应用版本
 * @param {string|null} p.appVersion      用户/基线的 Obsidian 版本
 * @param {object|null} p.versionsMap     versions.json（app 版本 → 插件版本）
 * @param {string|null} p.pluginVersion   当前插件版本
 */
export function checkCompatibility({ minAppVersion, appVersion, versionsMap, pluginVersion }) {
  if (!minAppVersion) {
    return {
      verdict: 'undetermined',
      reason: '插件 manifest 未声明 minAppVersion，无法判断版本下限',
      basis: null,
    };
  }
  const minParsed = parseVersion(minAppVersion);
  if (!minParsed) {
    return {
      verdict: 'undetermined',
      reason: `minAppVersion "${minAppVersion}" 不是可解析的版本号`,
      basis: null,
    };
  }
  if (!appVersion) {
    return {
      verdict: 'undetermined',
      reason: '未提供 Obsidian 版本，无法比较',
      basis: { minAppVersion, appVersion: null },
    };
  }
  const appParsed = parseVersion(appVersion);
  if (!appParsed) {
    return {
      verdict: 'undetermined',
      reason: `给定应用版本 "${appVersion}" 不可解析`,
      basis: { minAppVersion, appVersion },
    };
  }

  const cmp = compareVersions(appVersion, minAppVersion);
  if (cmp === null) {
    return {
      verdict: 'undetermined',
      reason: '版本比较失败',
      basis: { minAppVersion, appVersion },
    };
  }

  if (cmp >= 0) {
    return {
      verdict: 'compatible',
      reason: `应用版本 ${appVersion} ≥ 最低要求 ${minAppVersion}`,
      basis: { minAppVersion, appVersion },
    };
  }

  // 应用版本低于最低要求：versions.json 若能给出兼容的旧版插件，则说明「有可用回退」
  if (versionsMap && typeof versionsMap === 'object') {
    const fallback = resolveFallbackVersion(versionsMap, appVersion);
    if (fallback) {
      return {
        verdict: 'incompatible',
        reason: `当前插件版本 ${pluginVersion || '?'} 要求 ${minAppVersion}，高于应用版本 ${appVersion}；但 versions.json 提供了兼容回退版本 ${fallback}`,
        basis: { minAppVersion, appVersion, fallbackVersion: fallback },
        hasFallback: true,
      };
    }
    return {
      verdict: 'incompatible',
      reason: `要求 ${minAppVersion}，高于应用版本 ${appVersion}；versions.json 未提供可回退版本`,
      basis: { minAppVersion, appVersion },
      hasFallback: false,
    };
  }

  return {
    verdict: 'incompatible',
    reason: `要求 ${minAppVersion}，高于应用版本 ${appVersion}；该插件未提供 versions.json，无回退路径`,
    basis: { minAppVersion, appVersion },
    hasFallback: false,
  };
}

/**
 * 从 versions.json 找出适配给定应用版本的最高插件版本。
 * versions.json 形如 { "1.4.0": "2.1.0", "1.5.0": "2.2.0" }（应用版本 → 插件版本）。
 */
export function resolveFallbackVersion(versionsMap, appVersion) {
  const entries = Object.entries(versionsMap)
    .map(([app, plugin]) => ({ app, plugin, parsed: parseVersion(app) }))
    .filter((e) => e.parsed);
  if (entries.length === 0) return null;

  const eligible = entries.filter((e) => compareVersions(appVersion, e.app) >= 0);
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => compareVersions(b.app, a.app));
  return eligible[0].plugin;
}

/**
 * 基础检查。每项输出 { id, level, title, detail, basis, advisory }。
 * level: info / warn / unknown / fail —— 注意没有 "pass=safe" 这一档。
 *
 * advisory=true 表示「常驻能力边界声明」，不参与整体状态汇总。
 * 否则像「无官方安全评分」这种对每个插件都成立的说明，会把所有插件的状态
 * 永久压成 unknown，使状态字段失去区分度（此缺陷由端到端实测抓出）。
 */
export function runChecks(record, ctx = {}) {
  const checks = [];
  const push = (id, level, title, detail, basis = null, advisory = false) =>
    checks.push({ id, level, title, detail, basis, advisory });

  const { manifest, license, removedEntry, deprecationEntry, versionsMap, repoStatus } = record;

  // 1. 仓库可达性 —— 三态，绝不把 unknown 写成 fail
  if (repoStatus === 'missing') {
    push('repo-reachable', 'fail', '仓库不可达', 'manifest.json 返回 404，仓库可能已删除或改为私有');
  } else if (repoStatus === 'unknown') {
    push(
      'repo-reachable',
      'unknown',
      '仓库可达性未确定',
      `网络层失败（${record.repoStatusReason || '原因未记录'}），本次结论不可用；需重试`,
    );
  } else if (repoStatus === 'ok') {
    push('repo-reachable', 'info', '仓库可达', 'manifest.json 已成功读取');
  } else {
    // unchecked：调用方传入的是未核验记录，不应静默跳过
    push('repo-reachable', 'unknown', '尚未核验仓库可达性', '未读取 manifest.json，无可判定信息');
  }

  // 2. manifest 完整性
  if (manifest) {
    const required = ['id', 'name', 'version', 'minAppVersion', 'author'];
    const missing = required.filter((k) => !manifest[k]);
    if (missing.length) {
      push('manifest-complete', 'warn', 'manifest 缺字段', `缺少：${missing.join(', ')}`, missing);
    } else {
      push('manifest-complete', 'info', 'manifest 必填字段齐全', required.join(', '));
    }

    if (manifest.id && record.id && manifest.id !== record.id) {
      push(
        'manifest-id-match',
        'fail',
        'manifest.id 与注册表 id 不一致',
        `注册表 ${record.id} ≠ manifest ${manifest.id}`,
      );
    }
  } else if (repoStatus === 'ok') {
    push('manifest-complete', 'fail', 'manifest 不可解析', record.manifestError || '未取得有效 JSON');
  }

  // 3. 注册表元数据质量
  const metaMissing = [];
  if (!record.description) metaMissing.push('description');
  if (!record.author) metaMissing.push('author');
  if (!record.repo) metaMissing.push('repo');
  if (metaMissing.length) {
    push('registry-meta', 'warn', '注册表元数据缺失', `缺少：${metaMissing.join(', ')}`, metaMissing);
  }

  // 4. 许可证 —— 未知就是未知
  if (license?.status === 'found') {
    if (license.detection?.confidence === 'matched') {
      push(
        'license-declared',
        'info',
        `许可证：${license.detection.spdx}`,
        `${license.file}（${license.detection.note}）`,
        license.detection.evidence,
      );
    } else if (license.detection?.confidence === 'ambiguous') {
      push(
        'license-declared',
        'warn',
        '许可证特征冲突',
        license.detection.note,
        license.detection.candidates,
      );
    } else {
      push('license-declared', 'warn', '许可证无法识别', license.detection.note || '原文不匹配已知模板');
    }
  } else if (license?.status === 'missing') {
    push('license-declared', 'warn', '仓库未提供许可证文件', `已尝试：${license.tried?.join(', ')}`);
  } else if (license?.status === 'unknown') {
    push('license-declared', 'unknown', '许可证状态未确定', `抓取失败（${license.reason || '网络'}），不可据此判断无许可证`);
  }

  // 5. 官方下架记录 —— 这是唯一权威的失效信号
  if (removedEntry) {
    push('official-removed', 'fail', '官方已下架', `原因：${removedEntry.reason || '未说明'}`);
  }

  // 6. 官方版本弃用
  if (deprecationEntry?.length) {
    const isCurrentDeprecated =
      manifest?.version && deprecationEntry.includes(manifest.version);
    push(
      'deprecated-version',
      isCurrentDeprecated ? 'fail' : 'warn',
      isCurrentDeprecated ? '当前版本已被官方标记弃用' : '存在被弃用的历史版本',
      `弃用版本：${deprecationEntry.join(', ')}`,
      deprecationEntry,
    );
  }

  // 7. 维护活跃度（基于官方 stats 的 updated 字段，事实陈述，不给「健康」结论）
  //    注意字段名以 toRecord 产出的 updatedAt 为准（此前的 stats.updated 取法
  //    与之不匹配，导致该项从未触发——由渲染后的 DOM 文本核查发现）。
  const lastUpdated = record.updatedAt ?? record.stats?.updated ?? null;
  if (lastUpdated) {
    const days = Math.floor((Date.now() - lastUpdated) / 86400000);
    push(
      'last-update',
      days > 730 ? 'warn' : 'info',
      `最近更新：${days} 天前`,
      new Date(lastUpdated).toISOString(),
      { updatedAt: lastUpdated },
    );
  }

  // 8. versions.json 缺失（影响低版本用户能否回退）
  if (repoStatus === 'ok' && versionsMap === null) {
    push(
      'versions-map',
      'info',
      '未提供 versions.json',
      '低版本应用无法自动回退到兼容的旧版插件；非错误，属上游常态',
    );
  }

  // 9. 安全评估能力缺失 —— 必须显式声明，而不是假装检查过。
  //    但这是对每个插件都成立的能力边界，不参与状态汇总。
  push(
    'security-baseline',
    'unknown',
    '无官方安全评分可查',
    '该生态不存在公开的安全审计/评分接口；本工具不做代码审计，不给出「安全」结论',
    null,
    true,
  );

  // 10. 版本兼容性 —— 必须进入状态汇总。
  //     若只把它显示在「版本与兼容性」栏而不参与 summarize，会出现
  //     「要求 1.20.0、用户 1.14.5」却整体判为 ok 的误导性结论（实测抓出）。
  if (ctx.appVersion) {
    const compat = checkCompatibility({
      minAppVersion: record.minAppVersion,
      appVersion: ctx.appVersion,
      versionsMap: record.versionsMap,
      pluginVersion: record.version,
    });
    if (compat.verdict === 'incompatible') {
      push(
        'version-compat',
        'fail',
        '与你的应用版本不兼容',
        compat.reason,
        compat.basis,
      );
    } else if (compat.verdict === 'undetermined') {
      push('version-compat', 'unknown', '兼容性未确定', compat.reason, compat.basis);
    } else {
      push('version-compat', 'info', '版本要求满足', compat.reason, compat.basis);
    }
  }

  return checks;
}

/**
 * 汇总整体状态。只看**可判定项**（advisory=false）。
 * 优先级：fail > unknown > warn > ok
 * 注意 warn 单独成档：它表示「有已知瑕疵但未确认失效」，与 ok 不同。
 */
export function summarize(checks) {
  const decisive = checks.filter((c) => !c.advisory);
  if (decisive.some((c) => c.level === 'fail')) return 'fail';
  if (decisive.some((c) => c.level === 'unknown')) return 'unknown';
  if (decisive.some((c) => c.level === 'warn')) return 'warn';
  return 'ok';
}
