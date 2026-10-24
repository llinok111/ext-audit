/**
 * 许可证识别测试。
 * 重点验证：不猜、不默认、冲突时保留歧义。
 */
import { test, assert, run } from './harness.mjs';
import { detectLicense, licenseClass } from '../src/license.mjs';

test('识别 MIT', () => {
  const text = `MIT License

Copyright (c) 2021 Michael Brenan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.`;
  const r = detectLicense(text);
  assert.equal(r.spdx, 'MIT');
  assert.equal(r.confidence, 'matched');
  assert.ok(r.evidence.length > 0);
});

test('识别 GPL-3.0 且不被 LGPL 误判', () => {
  const gpl = `                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>`;
  const r = detectLicense(gpl);
  assert.equal(r.spdx, 'GPL-3.0');
});

test('LGPL 文本不会被识别成 GPL', () => {
  const lgpl = `GNU LESSER GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007`;
  const r = detectLicense(lgpl);
  assert.equal(r.spdx, 'LGPL-3.0');
  assert.notEqual(r.spdx, 'GPL-3.0');
});

test('AGPL 优先于 GPL', () => {
  const agpl = `GNU AFFERO GENERAL PUBLIC LICENSE
                       Version 3, 19 November 2007`;
  const r = detectLicense(agpl);
  assert.equal(r.spdx, 'AGPL-3.0');
});

test('Apache-2.0 不会被误判为 MIT', () => {
  const apache = `Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/`;
  const r = detectLicense(apache);
  assert.equal(r.spdx, 'Apache-2.0');
});

test('BSD-3 与 BSD-2 可区分', () => {
  const bsd3 = `Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software.`;
  assert.equal(detectLicense(bsd3).spdx, 'BSD-3-Clause');

  const bsd2 = `Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
1. Redistributions of source code must retain the above copyright notice.`;
  assert.equal(detectLicense(bsd2).spdx, 'BSD-2-Clause');
});

test('真实 ISC 变体原文（obsidian-sample-plugin）识别为 ISC', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../data/sample-license-isc.txt', import.meta.url), 'utf8');
  const r = detectLicense(text);
  assert.equal(r.spdx, 'ISC');
  assert.equal(r.confidence, 'matched');
});

test('完全自定义条款返回 none，不硬套许可证', () => {
  const custom = `Copyright (C) 2024 Someone.
All rights reserved. Redistribution in source form is prohibited without
prior written permission from the copyright holder.`;
  const r = detectLicense(custom);
  assert.equal(r.spdx, null);
  assert.equal(r.confidence, 'none');
  assert.ok(r.note.includes('人工判定'));
});

test('空文本返回 none', () => {
  const r = detectLicense('');
  assert.equal(r.spdx, null);
  assert.equal(r.confidence, 'none');
});

test('非字符串输入不崩溃', () => {
  const r = detectLicense(null);
  assert.equal(r.spdx, null);
});

test('licenseClass 正确归类', () => {
  assert.equal(licenseClass('MIT').key, 'permissive');
  assert.equal(licenseClass('GPL-3.0').key, 'copyleft');
  assert.equal(licenseClass('AGPL-3.0').key, 'copyleft');
  assert.equal(licenseClass('Unlicense').key, 'public-domain');
  assert.equal(licenseClass(null).key, 'unknown');
});

await run();
