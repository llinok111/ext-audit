/**
 * 测试运行器（零依赖，node:test 之外的自研轻量断言，便于离线跑）。
 * 用 node --test 亦可；此处保持纯 stdlib，避免任何安装。
 */
import assert from 'node:assert/strict';

const tests = [];
export function test(name, fn) {
  tests.push({ name, fn });
}
export async function run() {
  let pass = 0;
  const failures = [];
  for (const t of tests) {
    try {
      await t.fn();
      pass += 1;
      console.log(`  \u2713 ${t.name}`);
    } catch (err) {
      failures.push({ name: t.name, err });
      console.log(`  \u2717 ${t.name}\n      ${err.message.split('\n')[0]}`);
    }
  }
  console.log(`\n${pass}/${tests.length} passed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`- ${f.name}: ${f.err.message}`);
    process.exitCode = 1;
  }
  return { pass, total: tests.length, failures };
}
export { assert };
