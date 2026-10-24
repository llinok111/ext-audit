/**
 * 统一测试入口：依次运行全部测试文件，汇总结果。
 * 全部离线、无第三方依赖。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname);

const FILES = [
  'license.test.mjs',
  'verify.test.mjs',
  'indexer.test.mjs',
  'sources.test.mjs',
  'cache.test.mjs',
];

function runFile(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, file)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      const m = out.match(/(\d+)\/(\d+) passed/);
      resolve({ file, code, pass: m ? Number(m[1]) : 0, total: m ? Number(m[2]) : 0, out });
    });
  });
}

let totalPass = 0;
let totalAll = 0;
let failed = 0;

for (const f of FILES) {
  const r = await runFile(f);
  const ok = r.code === 0 && r.pass === r.total;
  console.log(`${ok ? '\u2713' : '\u2717'} ${f.padEnd(22)} ${r.pass}/${r.total}`);
  if (!ok) {
    failed += 1;
    console.log(r.out.split('\n').filter((l) => l.includes('\u2717') || l.includes('Failures') || l.startsWith('- ')).join('\n'));
  }
  totalPass += r.pass;
  totalAll += r.total;
}

console.log(`\n合计 ${totalPass}/${totalAll} 通过，${failed} 个文件有失败`);
process.exitCode = failed ? 1 : 0;
