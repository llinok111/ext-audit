/**
 * 许可证识别。
 *
 * 纪律：这里做的是**文本特征匹配**，不是法律判断。
 * - 匹配不到 → 'unknown'，绝不让它掉到某个默认值上。
 * - 匹配到多组互相冲突的特征 → 'ambiguous'。
 * - 只有特征足够唯一时才给出 SPDX 标识。
 * 界面上必须同时呈现「识别依据」与「原文链接」，由用户自行复核。
 */

/**
 * 规则表。每条含唯一性要求：命中 anchors 全部且 exclusion 不成立才判定。
 * anchors 为大小写不敏感的子串，正则仅用于需要结构的场景。
 */
const RULES = [
  {
    spdx: 'MIT',
    name: 'MIT License',
    anchors: [
      /permission is hereby granted, free of charge/i,
      /the above copyright notice and this permission notice/i,
      /THE SOFTWARE IS PROVIDED "?AS IS"?/i,
    ],
    exclusion: [/GNU (AFFERO|LESSER|GENERAL) PUBLIC LICENSE/i],
  },
  {
    spdx: 'Apache-2.0',
    name: 'Apache License 2.0',
    anchors: [/Apache License\s*,?\s*Version 2\.0/i, /www\.apache\.org\/licenses/i],
    exclusion: [/GNU (AFFERO|LESSER|GENERAL) PUBLIC LICENSE/i],
  },
  {
    spdx: 'AGPL-3.0',
    name: 'GNU Affero General Public License v3.0',
    anchors: [/GNU AFFERO GENERAL PUBLIC LICENSE/i, /Version 3/i],
    exclusion: [],
  },
  {
    spdx: 'LGPL-3.0',
    name: 'GNU Lesser General Public License v3.0',
    anchors: [/GNU LESSER GENERAL PUBLIC LICENSE/i, /Version 3/i],
    exclusion: [/GNU AFFERO GENERAL PUBLIC LICENSE/i],
  },
  {
    spdx: 'LGPL-2.1',
    name: 'GNU Lesser General Public License v2.1',
    anchors: [/GNU LESSER GENERAL PUBLIC LICENSE/i, /Version 2\.1/i],
    exclusion: [/GNU AFFERO GENERAL PUBLIC LICENSE/i],
  },
  {
    spdx: 'GPL-3.0',
    name: 'GNU General Public License v3.0',
    anchors: [
      /GNU GENERAL PUBLIC LICENSE/i,
      /Version 3/i,
    ],
    // 关键：LGPL/Affero 文本里也含 "GNU ... GENERAL PUBLIC LICENSE"，必须先排除
    exclusion: [/GNU (LESSER|AFFERO) GENERAL PUBLIC LICENSE/i],
  },
  {
    spdx: 'GPL-2.0',
    name: 'GNU General Public License v2.0',
    anchors: [/GNU GENERAL PUBLIC LICENSE/i, /Version 2/i],
    exclusion: [/GNU (LESSER|AFFERO) GENERAL PUBLIC LICENSE/i],
  },
  {
    spdx: 'MPL-2.0',
    name: 'Mozilla Public License 2.0',
    anchors: [/Mozilla Public License\s*(Version\s*)?2\.0/i],
    exclusion: [],
  },
  {
    spdx: 'BSD-3-Clause',
    name: 'BSD 3-Clause License',
    anchors: [
      /Redistribution and use in source and binary forms/i,
      /Neither the name of/i,
    ],
    exclusion: [],
  },
  {
    spdx: 'BSD-2-Clause',
    name: 'BSD 2-Clause License',
    anchors: [/Redistribution and use in source and binary forms/i],
    exclusion: [/Neither the name of/i],
  },
  {
    spdx: 'ISC',
    name: 'ISC License',
    anchors: [
      /Permission to use, copy, modify, and\/or distribute this software/i,
      /THE SOFTWARE IS PROVIDED "?AS IS"?/i,
    ],
    exclusion: [],
  },
  {
    spdx: 'Unlicense',
    name: 'The Unlicense',
    anchors: [/This is free and unencumbered software released into the public domain/i],
    exclusion: [],
  },
  {
    spdx: 'CC0-1.0',
    name: 'Creative Commons Zero v1.0 Universal',
    anchors: [/CC0 1\.0 Universal/i],
    exclusion: [],
  },
];

/** 识别一段许可证原文。返回结构化结论，永不返回 null。 */
export function detectLicense(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return {
      spdx: null,
      name: null,
      confidence: 'none',
      evidence: [],
      note: '未取得许可证原文',
    };
  }

  // 只看前 4000 字符：许可证头部足以判定，尾部多是附录与免责声明噪声
  const head = text.slice(0, 4000);
  const hits = [];

  for (const rule of RULES) {
    const allAnchors = rule.anchors.every((re) => re.test(head));
    if (!allAnchors) continue;
    const excluded = rule.exclusion.some((re) => re.test(head));
    if (excluded) continue;
    hits.push(rule);
  }

  if (hits.length === 0) {
    return {
      spdx: null,
      name: null,
      confidence: 'none',
      evidence: [],
      note: '原文存在但不匹配任何已知许可证特征，需人工判定',
    };
  }

  if (hits.length > 1) {
    return {
      spdx: null,
      name: null,
      confidence: 'ambiguous',
      candidates: hits.map((h) => h.spdx),
      evidence: hits.map((h) => `${h.spdx}: ${h.anchors.map(String).join(' | ')}`),
      note: `同时命中 ${hits.length} 组特征（${hits.map((h) => h.spdx).join(', ')}），不做单选`,
    };
  }

  const hit = hits[0];
  return {
    spdx: hit.spdx,
    name: hit.name,
    confidence: 'matched',
    evidence: hit.anchors.map((re) => String(re)),
    note: '基于原文特征匹配，非法律结论；请核对原文',
  };
}

/** 许可证对二次分发/修改的粗分类，仅作提示，不替代法律意见。 */
export function licenseClass(spdx) {
  if (!spdx) return { key: 'unknown', label: '未知' };
  if (spdx === 'MIT' || spdx === 'ISC' || spdx === 'BSD-2-Clause' || spdx === 'BSD-3-Clause' || spdx === 'Apache-2.0') {
    return { key: 'permissive', label: '宽松型' };
  }
  if (spdx === 'Unlicense' || spdx === 'CC0-1.0') {
    return { key: 'public-domain', label: '公共领域' };
  }
  if (spdx.startsWith('GPL') || spdx.startsWith('AGPL') || spdx.startsWith('LGPL') || spdx === 'MPL-2.0') {
    return { key: 'copyleft', label: '传染型' };
  }
  return { key: 'unknown', label: '未知' };
}
