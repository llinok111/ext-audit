# 验收记录

> 生成时间：2026-10-24　环境：Windows / Git Bash / Node v22.22.2 / Chrome headless

## 1. 测试

```
✓ license.test.mjs       11/11
✓ verify.test.mjs        33/33
✓ indexer.test.mjs       18/18
✓ sources.test.mjs       11/11
✓ cache.test.mjs          7/7

合计 80/80 通过，0 个文件有失败
```

全部离线、确定性，无需网络。

## 2. 需求点覆盖

| 需求 | 实现 | 验证 |
|---|---|---|
| 搜索 | `search()` 可解释排序，返回命中字段与位置 | `indexer.test.mjs` 9 项 + CLI 实跑 |
| 元数据展示 | 名称/ID/作者/仓库/下载量/更新时间，缺失显示「未提供」 | 界面 DOM 核查 |
| 版本信息 | 当前版本、`minAppVersion`、历史版本、兼容判定 | `verify.test.mjs` 12 项 |
| 许可证标识 | 7 个候选文件名试探 + 文本特征匹配 + 原文链接 + 命中依据 | `license.test.mjs` 11 项 |
| 来源链接 | 每条记录保留注册表/stats/manifest/versions/LICENSE 原始 URL | 界面「来源」区块 |
| 可执行基础检查 | 11 项检查，输出 level + detail + basis | `verify.test.mjs` + CLI 输出 |
| 不擅自标注安全 | 常驻 `security-baseline` 声明，永不产出「安全」结论 | 专项测试 3 项 |
| 不擅自标注兼容 | 三态判定，未提供版本时 undetermined | 专项测试 4 项 |
| 失效链接测试 | 404 → fail；网络失败 → unknown；404 不重试 | `sources.test.mjs` 4 项 |
| 缺少元数据测试 | 注册表字段缺失、manifest 字段缺失、ID 不一致 | `verify.test.mjs` 3 项 |
| 不兼容版本测试 | 低于下限无回退 → fail；有 versions.json 回退 → 标注回退版本 | `verify.test.mjs` 4 项 |
| 数据更新时间 | 顶部拉取时间 + 逐条最近更新 + 缓存年龄 | 界面 + CLI |
| 局限说明 | 界面弹窗 + `docs/LIMITATIONS.md` + CLI `sources` 输出 | 三处一致 |

## 3. 真实网络端到端

注册表全量拉取成功：**9389** 条，统计 **9383** 条，下架 **175** 条，客户端版本 `1.1.9 → 1.14.5`。

抽样 12 个真实插件核验结果：

```
状态分布: {"ok":10,"warn":2}
许可证分布: {"MIT":10,"Apache-2.0":1,"missing":1}
```

单插件深核（calendar）：版本 1.5.10、minApp 0.9.11、MIT、2012 天未更新 → **warn**，与事实一致。

## 4. 界面验收（无读图能力下的三重证据）

### 4.1 渲染后 DOM 文本

确认列表渲染 60 行、详情五大区块齐全：元数据 / 版本与兼容性 / 许可证 / 基础检查 / 来源。
检查项计数正确显示「5 项可判定 · 1 项常驻声明」。

### 4.2 页面内布局与对比度审计（真实几何数值）

```
horizontalOverflow: false
issues: []                       // 零布局问题
rowCount: 60, checkCount: 6
对比度（门槛 4.5:1）：
  .d-title    20px  18.43  ok
  .d-desc     13.5px 13.08  ok
  dl.kv dt    12.5px  7.37  ok
  dl.kv dd    13px   18.43  ok
  .check .cdetail 12px 7.37  ok
  .row .rname 13.5px 15.27  ok
  .row .rmeta 11px    6.11  ok
  footer.foot 11.5px  7.37  ok
  .list-meta  11.5px  7.37  ok
```

最低 6.11:1，全部达标。

### 4.3 截图像素统计（自写 PNG 解码）

| 文件 | 尺寸 | 去重色数 | 平均亮度 | 行亮度 std | 分带极差 | 判定 |
|---|---|---|---|---|---|---|
| final-ok.png | 1440×1500 | 2658 | 10.93 | 11.52 | 17.16 | 有内容 |
| final-fail.png | 1440×1500 | 2210 | 8.16 | 9.67 | 7.06 | 有内容 |

五项判据（尺寸 / 非纯色 / 非全黑全白 / 纵向结构 / 分带差异）全部通过，排除白屏与半渲染。

## 5. 场景判定一致性

| 插件 | 构造场景 | 期望 | 实际 |
|---|---|---|---|
| hotkeysplus-obsidian | MIT 许可证，字段齐全 | ok | ok |
| obsidian-git | minApp 1.20.0 > 1.14.5 | fail | fail |
| table-editor-obsidian | manifest 网络失败 | unknown | unknown |
| note-refactor-obsidian | manifest.id 与注册表不一致 | fail | fail |
| nldates-obsidian | 无许可证文件 | warn | warn |
| obsidian-reading-time | 官方下架清单命中 | fail | fail |

## 6. 交付物独立验证

ZIP 解压到全新目录后：

- 文件数 33
- `node test/run-all.mjs` → 80/80 通过
- `node tools/build-web.mjs` → 66.5 KB，无符号冲突
- 缺缓存时离线模式给出明确错误：`离线模式下缓存中缺少注册表`（不返回空索引）
- `--help` 正常

## 7. 开发过程中由测试抓出的真实缺陷

| # | 缺陷 | 发现方式 | 影响 |
|---|---|---|---|
| 1 | `parseVersion("1.x.0")` 返回 1.0.0 | 单元测试 | 非法版本被静默接受，污染兼容判定 |
| 2 | 常驻声明把全部插件压成 unknown | 端到端实跑 | 状态字段失去区分度 |
| 3 | `{...v, ...record}` 展开顺序错，核验结果被覆盖 | DOM 文本核查 | 「仓库可达」检查消失 |
| 4 | `last-update` 读 `record.stats.updated`，实际字段是 `updatedAt` | DOM 文本核查 | 该项从不触发 |
| 5 | 兼容性未进入状态汇总 | 多场景 UI 核查 | 不兼容插件被判为 ok |
| 6 | 缓存命中也只解析 registry，其余源为空 | 离线模式实测 | 统计/下架/版本全为 0 |
| 7 | `--cache-dir` 的值被当作插件 ID | CLI 实跑 | 误报「注册表中不存在」 |

以上均已修复并有测试锁定。
