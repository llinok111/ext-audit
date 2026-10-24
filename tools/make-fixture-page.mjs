/**
 * 生成「离线验收页」：把真实注册表样本与预设响应注入成 fetch 桩，
 * 使得渲染不依赖网络、结果确定可复现。仅用于验收与截图，不进最终包。
 *
 * 用法：node tools/make-fixture-page.mjs
 * 产物：shots/harness.html
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'shots');

async function tryLocalOrFetch() {
  // 优先用本机已缓存的注册表（若存在），避免重复大流量拉取
  const cached = 'E:/tmp/obs/cp.json';
  try {
    return JSON.parse(await readFile(cached, 'utf8'));
  } catch {
    const url = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`registry fetch ${res.status}`);
    return await res.json();
  }
}

const registry = await tryLocalOrFetch();
console.log('注册表样本源：', registry.length, '条');

// 取前 60 条真实条目，保证渲染有足够内容
const sample = registry.slice(0, 60);

const stats = {};
sample.forEach((p, i) => {
  stats[p.id] = {
    downloads: (60 - i) * 1234 + i,
    updated: Date.now() - i * 86400000 * 13,
    '1.0.0': 10,
    '1.1.0': 20,
  };
});

// 已下架样本：把其中一条标记为官方下架，用于验证 fail 级渲染
const removedTarget = sample[7];
const removed = [{ id: removedTarget.id, name: removedTarget.name, reason: 'Repository archived' }];

// 逐插件响应桩：覆盖「有许可证 / 无许可证 / 仓库 404 / 网络失败」四类真实情形
const responses = new Map();
const pick = (i) => sample[i];

function setManifest(p, manifest) {
  responses.set(`https://raw.githubusercontent.com/${p.repo}/HEAD/manifest.json`, {
    status: 200,
    body: JSON.stringify(manifest),
  });
}

// 1) 正常：MIT 许可证
setManifest(pick(0), {
  id: pick(0).id,
  name: pick(0).name,
  version: '2.42.0',
  minAppVersion: '1.13.0',
  description: pick(0).description,
  author: pick(0).author,
  authorUrl: 'https://github.com/example',
  isDesktopOnly: false,
});
responses.set(`https://raw.githubusercontent.com/${pick(0).repo}/HEAD/LICENSE`, {
  status: 200,
  body: `MIT License\n\nCopyright (c) 2021 Someone\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software\n\nThe above copyright notice and this permission notice shall be included in all copies\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.`,
});

// 2) 缺许可证文件
setManifest(pick(1), {
  id: pick(1).id,
  name: pick(1).name,
  version: '1.0.9',
  minAppVersion: '0.11.5',
  description: pick(1).description,
  author: pick(1).author,
  isDesktopOnly: true,
});

// 3) 不兼容：minAppVersion 高于展示用应用版本 1.14.5
setManifest(pick(2), {
  id: pick(2).id,
  name: pick(2).name,
  version: '3.0.0',
  minAppVersion: '1.20.0',
  description: pick(2).description,
  author: pick(2).author,
  isDesktopOnly: false,
});
responses.set(`https://raw.githubusercontent.com/${pick(2).repo}/HEAD/LICENSE.txt`, {
  status: 200,
  body: `                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n\n Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>`,
});

// 4) 仓库 404
responses.set(`https://raw.githubusercontent.com/${pick(3).repo}/HEAD/manifest.json`, { status: 404 });

// 5) 网络失败（不可判定）
responses.set(`https://raw.githubusercontent.com/${pick(4).repo}/HEAD/manifest.json`, { status: 'NETWORK_ERROR' });

// 6) manifest 缺字段 + id 不一致
setManifest(pick(5), {
  id: 'wrong-id-demo',
  name: pick(5).name,
  author: pick(5).author,
});

// 7) 许可证特征冲突（同时含 MIT 与 GPL 片段）
setManifest(pick(6), {
  id: pick(6).id,
  name: pick(6).name,
  version: '0.5.0',
  minAppVersion: '1.0.0',
  author: pick(6).author,
  isDesktopOnly: false,
});
responses.set(`https://raw.githubusercontent.com/${pick(6).repo}/HEAD/LICENSE.md`, {
  status: 200,
  body: `MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n\nThe above copyright notice and this permission notice shall be included\n\nTHE SOFTWARE IS PROVIDED "AS IS"\n\n---\n\n                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007`,
});

// 其余未预设的：一律 404，模拟「仓库无 manifest」——但更真实的是让它们 unknown
const stubScript = `
(function(){
  const REG = ${JSON.stringify(sample)};
  const STATS = ${JSON.stringify(stats)};
  const REMOVED = ${JSON.stringify(removed)};
  const DEP = { ${JSON.stringify(removedTarget.id)}: ['0.9.0'] };
  const DESKTOP = { minimumVersion: '1.1.9', latestVersion: '1.14.5' };
  const RESP = new Map(${JSON.stringify([...responses.entries()])});

  function json(data){
    return { ok: true, status: 200, text: async () => JSON.stringify(data), json: async () => data };
  }

  window.fetch = async function(url){
    const u = String(url);
    if (u.endsWith('community-plugins.json')) return json(REG);
    if (u.endsWith('community-plugin-stats.json')) return json(STATS);
    if (u.endsWith('community-plugins-removed.json')) return json(REMOVED);
    if (u.endsWith('community-plugin-deprecation.json')) return json(DEP);
    if (u.endsWith('desktop-releases.json')) return json(DESKTOP);

    const hit = RESP.get(u);
    if (hit) {
      if (hit.status === 'NETWORK_ERROR') { throw new TypeError('fixture: simulated network failure'); }
      if (hit.status === 200) return { ok: true, status: 200, text: async () => hit.body, json: async () => JSON.parse(hit.body) };
      return { ok: false, status: hit.status, text: async () => '' };
    }
    // 未预设：当作仓库无 manifest（404）
    return { ok: false, status: 404, text: async () => '' };
  };
})();
`;

const dist = await readFile(path.join(ROOT, 'web/dist/ext-audit.html'), 'utf8');
// 在主体脚本之前插入桩
const harness = dist.replace('<script>', `<script>${stubScript}</script>\n<script>`);
await mkdir(TMP, { recursive: true });
await writeFile(path.join(TMP, 'harness.html'), harness, 'utf8');
console.log('已生成 shots/harness.html');
console.log('预置响应数：', responses.size);
console.log('样本：');
[0, 1, 2, 3, 4, 5, 6, 7].forEach((i) => console.log(`  [${i}] ${pick(i).id}`));
