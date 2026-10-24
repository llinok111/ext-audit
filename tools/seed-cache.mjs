#!/usr/bin/env node
/**
 * 一次性把已实测抓取到的官方文件写入缓存（带 sha256 与来源）。
 * 用于网络不可达时建立基线缓存。数据全部来自官方 raw 地址，此处只做搬运。
 *
 * 用法：node tools/seed-cache.mjs <源目录> <缓存目录>
 *   源目录需含：community-plugins.json / community-plugin-stats.json
 *              community-plugins-removed.json / community-plugin-deprecation.json
 *              desktop-releases.json
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../src/cache.mjs';
import { SOURCES } from '../src/sources.mjs';

const [srcDir, cacheDir] = process.argv.slice(2);
if (!srcDir || !cacheDir) {
  console.error('用法：node tools/seed-cache.mjs <源目录> <缓存目录>');
  process.exit(3);
}

// 源文件名 → 源 id
const FILES = {
  registry: 'community-plugins.json',
  stats: 'community-plugin-stats.json',
  removed: 'community-plugins-removed.json',
  deprecation: 'community-plugin-deprecation.json',
  desktop: 'desktop-releases.json',
};

await mkdir(cacheDir, { recursive: true });
const meta = { savedAt: Date.now(), sources: {}, note: 'seeded from previously fetched official files' };

for (const [id, filename] of Object.entries(FILES)) {
  const p = path.join(srcDir, filename);
  try {
    await access(p);
  } catch {
    console.warn(`跳过 ${id}：缺少 ${filename}`);
    continue;
  }
  const body = await readFile(p, 'utf8');
  // 校验必须是合法 JSON，避免把错误内容写进缓存
  JSON.parse(body);
  await writeFile(path.join(cacheDir, filename), body, 'utf8');
  meta.sources[id] = {
    file: filename,
    url: SOURCES[id].url,
    status: 200,
    fetchedAt: null,
    bytes: Buffer.byteLength(body, 'utf8'),
    sha256: sha256(body),
    seeded: true,
  };
  console.log(`${id.padEnd(12)} ${String(meta.sources[id].bytes).padStart(9)} B  ${filename}`);
}

await writeFile(path.join(cacheDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
console.log(`\n缓存已写入 ${cacheDir}`);
console.log(`源数：${Object.keys(meta.sources).length}/${Object.keys(FILES).length}`);
