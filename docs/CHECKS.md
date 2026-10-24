# 检查项定义

每个检查项输出固定结构，便于程序消费与人工复核：

```json
{
  "id": "license-declared",
  "level": "info | warn | fail | unknown",
  "title": "许可证：MIT",
  "detail": "LICENSE（基于原文特征匹配，非法律结论；请核对原文）",
  "basis": ["/permission is hereby granted/i", "..."],
  "advisory": false
}
```

`basis` 是判定依据（命中特征、缺失字段名、版本比较对象等），界面中直接展开显示，便于证伪。

## 状态语义

| level | 含义 | 是否影响整体状态 |
|---|---|---|
| `info` | 可观测的正常事实 | 否 |
| `warn` | 已确认的瑕疵，但未构成失效 | 是（降为 warn） |
| `fail` | 确定性失效或不一致 | 是（判为 fail） |
| `unknown` | 无法判定（网络、字段未声明） | 是（判为 unknown） |

整体状态优先级：`fail > unknown > warn > ok`。

`advisory: true` 的项表示「对每个插件都成立的能力边界声明」，**完全排除**在汇总之外。

## 逐项定义

### `repo-reachable`
- **判据**：对 `https://raw.githubusercontent.com/<repo>/HEAD/manifest.json` 发起请求。
- `404` → fail（仓库删除、转私有或路径错误）。
- 超时 / 连接重置 / 5xx / 429 → **unknown**，detail 中记录具体原因（如 `timeout`、`network_TypeError`）。
- `200` → info。
- `unchecked` → unknown（调用方传入了未核验记录，不静默跳过）。

### `manifest-complete`
- **判据**：`id / name / version / minAppVersion / author` 是否全部非空。
- 有缺失 → warn，`basis` 列出缺失字段名。
- manifest 存在但 JSON 解析失败 → fail。

### `manifest-id-match`
- **判据**：`manifest.id` 是否等于注册表 `id`。
- 不一致 → fail。这是真实存在的元数据错误，会导致 Obsidian 安装错位。

### `registry-meta`
- **判据**：注册表 `description / author / repo` 是否缺失。
- 缺失 → warn，`basis` 列出字段名。

### `license-declared`
- **判据**：按 `LICENSE / LICENSE.md / LICENSE.txt / LICENCE / LICENCE.md / COPYING / COPYING.md` 顺序试探，第一个 200 即采用。
- 识别成功 → info，附 SPDX、文件名、命中特征、原文链接。
- 特征冲突 → warn（`ambiguous`）。
- 原文不匹配 → warn（`none`）。
- 全部 404 → warn（事实：仓库无许可证文件）。
- 中途网络失败 → **unknown**，并停止试探（**不得**断言无许可证）。

### `version-compat`
- **判据**：`compareVersions(appVersion, minAppVersion)`。
- `appVersion >= minAppVersion` → info。
- `<` → fail；若 `versions.json` 提供兼容旧版，detail 中给出回退版本号。
- `minAppVersion` 缺失或不可解析、或未提供 `appVersion` → unknown / 不产出。

### `official-removed`
- **判据**：注册表 id 是否出现在 `community-plugins-removed.json`（实测 175 条）。
- 命中 → fail，detail 带上官方给出的原因（如 `Repository archived`）。

### `deprecated-version`
- **判据**：当前 manifest 版本是否在 `community-plugin-deprecation.json` 的弃用列表中。
- 当前版本被弃用 → fail；仅有历史版本被弃用 → warn。

### `last-update`
- **判据**：`now - stats.updated` 的天数。
- `> 730` 天 → warn，否则 info。
- 字段名以 `toRecord` 产出的 `updatedAt` 为准（曾误取 `record.stats.updated` 导致该项从不触发，已由测试锁定）。

### `versions-map`
- **判据**：仓库是否存在 `versions.json`。
- 不存在 → info（属上游常态，非错误）。

### `security-baseline`（常驻）
- **判据**：无。这是一条固定声明。
- level 恒为 `unknown`，`advisory: true`。
- detail：该生态不存在公开的安全审计/评分接口；本工具不做代码审计，不给出「安全」结论。

## 为什么没有 `pass` 这一档

「通过」容易被读成「安全」或「推荐安装」。本工具用 `info` 表达「可观测的正常事实」，刻意避免赋予价值判断。

`ok` 整体状态仅表示：**本次可执行的检查未发现问题**。
