/**
 * 自写 PNG 解码 + 像素统计。用途：在无法读取图像内容的环境下，
 * 用数值证明截图不是白屏 / 空帧 / 半渲染。
 *
 * 不依赖任何第三方库：zlib 解压 + 手工反滤波。
 * 输出四条互相独立的判据：
 *   1. 尺寸        与预期窗口一致
 *   2. 去重色数    太低=纯色空帧
 *   3. 平均亮度    接近 0 或 255 = 全黑/全白
 *   4. 分带 stdev  逐行亮度标准差；全部为 0 = 未渲染任何内容
 */
import { readFile } from 'node:fs/promises';
import zlib from 'node:zlib';

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export async function decodePng(file) {
  const buf = await readFile(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }

  if (bitDepth !== 8) throw new Error(`仅支持 8bit，实际 ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`不支持 colorType ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  let rp = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rp];
    rp += 1;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const rawVal = raw[rp + x];
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let val;
      switch (filter) {
        case 0: val = rawVal; break;
        case 1: val = rawVal + a; break;
        case 2: val = rawVal + b; break;
        case 3: val = rawVal + ((a + b) >> 1); break;
        case 4: val = rawVal + paeth(a, b, c); break;
        default: throw new Error(`未知滤波 ${filter}`);
      }
      cur[x] = val & 0xff;
    }
    rp += stride;
  }

  return { width, height, channels, pixels: out };
}

export function stats({ width, height, channels, pixels }) {
  const colors = new Set();
  let sum = 0;
  let n = 0;
  const rowLum = new Float64Array(height);

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      const r = pixels[i];
      const g = channels >= 3 ? pixels[i + 1] : r;
      const b = channels >= 3 ? pixels[i + 2] : r;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += lum;
      n += 1;
      rowSum += lum;
      // 量化到 5bit 再计入，避免抗锯齿导致色数虚高
      if (colors.size < 400000) colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    }
    rowLum[y] = rowSum / width;
  }

  const mean = sum / n;
  let varSum = 0;
  for (let y = 0; y < height; y += 1) varSum += (rowLum[y] - mean) ** 2;
  const rowStd = Math.sqrt(varSum / height);

  // 分带：把画面纵向切 8 带，统计每带均值，用极差判断是否有内容分布
  const bands = [];
  const bh = Math.floor(height / 8);
  for (let k = 0; k < 8; k += 1) {
    let s = 0;
    let c = 0;
    for (let y = k * bh; y < (k + 1) * bh; y += 1) { s += rowLum[y]; c += 1; }
    bands.push(Number((s / c).toFixed(2)));
  }

  return {
    width,
    height,
    distinctColors: colors.size,
    meanLuminance: Number(mean.toFixed(2)),
    rowStd: Number(rowStd.toFixed(3)),
    bandMeans: bands,
    bandRange: Number((Math.max(...bands) - Math.min(...bands)).toFixed(2)),
  };
}

/** 判定是否为「有内容」的截图。阈值来自本机实测经验值。 */
export function verdict(s) {
  const checks = [];
  checks.push({ name: '尺寸合理', ok: s.width >= 800 && s.height >= 600, detail: `${s.width}x${s.height}` });
  checks.push({ name: '非纯色空帧', ok: s.distinctColors >= 24, detail: `去重色数 ${s.distinctColors}` });
  checks.push({
    name: '非全黑/全白',
    ok: s.meanLuminance > 3 && s.meanLuminance < 250,
    detail: `平均亮度 ${s.meanLuminance}`,
  });
  checks.push({ name: '存在纵向结构', ok: s.rowStd > 1.2, detail: `行亮度标准差 ${s.rowStd}` });
  checks.push({ name: '分带有差异', ok: s.bandRange > 2, detail: `分带极差 ${s.bandRange}` });
  return { pass: checks.every((c) => c.ok), checks };
}

if (process.argv[1] && process.argv[1].endsWith('pngstats.mjs')) {
  const files = process.argv.slice(2);
  for (const f of files) {
    const img = await decodePng(f);
    const s = stats(img);
    const v = verdict(s);
    console.log(`\n${f}`);
    console.log(`  ${s.width}x${s.height} | 色数 ${s.distinctColors} | 亮度 ${s.meanLuminance} | 行std ${s.rowStd} | 分带 ${s.bandMeans.join(',')}`);
    for (const c of v.checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name} (${c.detail})`);
    console.log(`  → ${v.pass ? '判定：有内容' : '判定：疑似空帧/异常'}`);
  }
}
