/**
 * 本地缓存（带溯源）。
 *
 * 为什么需要：实测该数据源在受限网络下会长时间不可达（2026-10-24 17:2x
 * 连续两次连接直接失败，另一轮单次请求耗时 40 秒）。没有缓存时工具完全不可用。
 *
 * 但缓存不能变成「偷偷内置的数据快照」：官方仓库未声明许可证，工具不得随包
 * 分发数据集。因此缓存必须显式生成、带来源与时间戳、由用户自己决定是否复用，
 * 且界面/CLI 必须如实显示数据年龄。
 */
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const META = 'meta.json';

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 写入缓存目录。每个源一个 <id>.json，外加 meta.json 记录来源与时间。 */
export async function saveCache(dir, sources) {
  await mkdir(dir, { recursive: true });
  const meta = { savedAt: Date.now(), sources: {} };
  const ids = Object.keys(sources);

  await Promise.all(
    ids.map(async (id) => {
      const s = sources[id];
      if (s?.state !== 'ok' || !s.body) return;
      const file = `${id}.json`;
      await writeFile(path.join(dir, file), s.body, 'utf8');
      meta.sources[id] = {
        file,
        url: s.sourceUrl,
        status: s.status ?? null,
        fetchedAt: s.fetchedAt ?? null,
        bytes: Buffer.byteLength(s.body, 'utf8'),
        sha256: sha256(s.body),
      };
    }),
  );

  await writeFile(path.join(dir, META), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

/** 读取缓存。返回与 loadSources 相同形状的对象；缺哪个源就标记 missing。 */
export async function loadCache(dir) {
  const metaRaw = await readFile(path.join(dir, META), 'utf8');
  const meta = JSON.parse(metaRaw);
  const sources = {};

  for (const [id, info] of Object.entries(meta.sources)) {
    try {
      const body = await readFile(path.join(dir, info.file), 'utf8');
      const actual = sha256(body);
      if (actual !== info.sha256) {
        sources[id] = {
          state: 'invalid',
          reason: 'cache_checksum_mismatch',
          sourceUrl: info.url,
          fetchedAt: info.fetchedAt,
          label: id,
        };
        continue;
      }
      sources[id] = {
        state: 'ok',
        status: info.status,
        body,
        sourceUrl: info.url,
        fetchedAt: info.fetchedAt,
        label: id,
        fromCache: true,
        cacheBytes: info.bytes,
      };
    } catch (err) {
      sources[id] = {
        state: 'missing',
        reason: `cache_read:${err.code || err.message}`,
        sourceUrl: info.url,
        label: id,
      };
    }
  }

  return { meta, sources };
}

/** 判断缓存年龄（小时）。 */
export async function cacheAgeHours(dir) {
  try {
    const meta = JSON.parse(await readFile(path.join(dir, META), 'utf8'));
    return (Date.now() - meta.savedAt) / 3600000;
  } catch {
    return null;
  }
}
