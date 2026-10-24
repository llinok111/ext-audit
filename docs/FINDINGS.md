# 实测发现记录

> 所有数字均为 2026-10-24 在本机（Windows，Git Bash，Node v22.22.2）实测所得。
> 凡未实测的推断，文中明确标注为「未验证」。

## 1. 生态选择依据

考察对象：Obsidian 社区插件生态。

选择理由基于以下**已核实事实**，而非印象：

| 事实 | 核实方式 |
|---|---|
| 注册表 `community-plugins.json` 共 **9389** 条 | 直接拉取并计数 |
| 注册表每条仅 **5 个字段**：`id/name/author/description/repo` | 取全部条目字段并集，确认无第 6 个字段 |
| 版本、最低应用版本、许可证 **均不在注册表内** | 同上；这些字段位于各插件仓库的 `manifest.json` 与 `LICENSE*` |
| 官方**无任何**质量评分或安全审计接口 | 仓库根目录文件清单中无相关文件；官方文档亦未提供 |
| 插件分散在约 9000 个**独立第三方仓库** | `repo` 字段分布 |

这构成「资源分散、缺少统一发现与质量核验机制」的直接证据。

## 2. 数据源清单（全部公开只读，无需认证）

基址：`https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/`

| 文件 | 大小（实测） | 内容 |
|---|---|---|
| `community-plugins.json` | 2,870,052 B | 主注册表，9389 条 |
| `community-plugin-stats.json` | 2,756,165 B | 下载量与逐版本下载数，9383 条 |
| `community-plugins-removed.json` | 19,901 B | 官方下架清单，175 条，含 `reason` |
| `community-plugin-deprecation.json` | 1,012 B | 版本弃用清单，7 个插件共 63 个版本 |
| `desktop-releases.json` | — | 客户端版本基线，实测 `minimumVersion=1.1.9`、`latestVersion=1.14.5` |

单插件数据（按需拉取）：
- `https://raw.githubusercontent.com/<repo>/HEAD/manifest.json`
- `https://raw.githubusercontent.com/<repo>/HEAD/versions.json`（约半数仓库没有）
- `https://raw.githubusercontent.com/<repo>/HEAD/LICENSE*`（命名不统一）

## 3. 许可证状态：**不可整包分发**

实测：

```
raw .../obsidian-releases/HEAD/LICENSE       → 404
raw .../obsidian-releases/HEAD/LICENSE.md    → 404
raw .../obsidian-releases/HEAD/LICENSE.txt   → 404
GET /repos/obsidianmd/obsidian-releases/license → 404 {"message":"Not Found"}
```

仓库 `README.md` 明确写道：*"Obsidian is not open source software and this repo DOES NOT contain the source code of Obsidian."*

**结论与处置**：该仓库未声明许可证，因此本工具**不在交付包内附带任何数据快照**。所有数据运行时从官方地址读取，仅缓存在浏览器会话内存中。这一点写入界面「数据时间与局限」面板，避免用户误以为包内数据可自由再分发。

## 4. 网络可靠性：单次探测失败 **不能** 判定失效

这是本项目最重要的一条实测结论。

第一轮：500 条随机抽样，并发 8，超时 12 秒。

```
ok 243 | 404: 0 | ERR(网络层): 257
```

若此时直接把 ERR 当作「失效」，会得出 **257/500 = 51.4% 插件失效** 的错误结论。

第二轮：对这 257 条改为串行、超时 25 秒、无并发重试。

```
200: 225 | ERR:TypeError: 31 | ERR:AbortError: 1 | 404: 0
```

**225 条恢复为 200，确认 404 的一条都没有。**

补充对照实验（同一批 12 个知名仓库）：

```
串行：  7 条 ERR:TypeError，5 条 200，耗时 78.5 s
并发 8：12 条全部 200，耗时 10.0 s
```

即：在该网络环境下，**串行反而更容易失败**，失败形态是连接层的 `TypeError`，与资源是否存在无关。

**对设计的硬约束**：
1. 抓取层必须区分 `ok` / `missing(404)` / `unknown(网络失败)` 三态。
2. `unknown` 绝不参与「失效」判定，整体状态标记为「未确定」并要求重试。
3. 只有 404 是确定性结论，且 404 不重试（重试无意义）。
4. 5xx/429 视为暂时性，重试；网络异常重试并记录 `attempts`。

## 5. 数据质量实况

| 指标 | 实测值 |
|---|---|
| 重复 `id` | 0 |
| 缺失 `repo` | 0 |
| 格式错误的 `repo` | 0 |
| 缺失 `author` | 0 |
| 缺失 `description` | 0 |
| 作者标为 "Community Archive"（已归档孤儿） | 8 |
| 注册表有条目但统计中无记录 | 9 |
| 统计中无任何版本键 | 17 |
| 官方下架清单条数 | 175 |

下架原因分布（前几类）：

| 原因 | 条数 |
|---|---|
| Repository archived / Archived repository | 96（两种措辞合计） |
| Repository deleted | 10 |
| Developer banned from GitHub | 9 |
| Account deleted | 9 |
| No longer maintained / Unmaintained | 9 |
| Features available in app | 7 |
| Broken & unmaintained | 4 |

统计新鲜度（基于 `stats.updated`）：

| 距今天数 | 条数 |
|---|---|
| < 30 天 | 2,993 |
| 30–180 天 | 4,304 |
| 180–365 天 | 611 |
| > 365 天 | 1,475 |

最新一条更新时间 `2026-10-24T00:09:21Z`，最旧 `2020-11-09T08:06:52Z`。

## 6. 许可证文件命名不统一

抽样 8 个知名仓库，逐一试探 6 个候选文件名：

| 仓库 | 实际文件 |
|---|---|
| obsidianmd/obsidian-sample-plugin | `LICENSE`（ISC 变体，非标准 MIT） |
| blacksmithgu/obsidian-dataview | `LICENSE.txt` |
| SilentVoid13/Templater | **无许可证文件** |
| Vinzent03/obsidian-git | `LICENSE`（MIT） |
| zsviczian/obsidian-excalidraw-plugin | `LICENSE`（AGPL-3.0） |
| mgmeyers/obsidian-style-settings | `LICENSE.md`（GPL-3.0） |
| pjeby/hotkey-helper | **无许可证文件** |
| liamcain/obsidian-calendar-plugin | `LICENSE`（MIT） |

**处置**：候选名列表为 `LICENSE / LICENSE.md / LICENSE.txt / LICENCE / LICENCE.md / COPYING / COPYING.md`，逐个试探；全部 404 才判「仓库无许可证文件」；中途遇网络失败立即停止并标记「未确定」，不得断言无许可证。

## 7. 浏览器直连可行性

```
Access-Control-Allow-Origin: *
Cache-Control: max-age=300
```

`raw.githubusercontent.com` 对注册表与 manifest 均返回 `ACAO: *`，因此浏览器可直连，**无需自建代理服务器**。这也意味着工具可以做成纯静态单文件，双击即用。

## 8. 未验证事项（明确声明）

以下内容本次**未**验证，不得当作已知事实：

1. 插件实际运行行为与安全性——本工具不做代码审计。
2. `minAppVersion` 声明与实际可用性是否一致——只做版本号比较，不做实测。
3. 未抽样到的约 8900 个插件的 manifest 可获取率。
4. GitHub API 的许可证端点在其他仓库上的行为（本机未认证配额仅 60 次/小时，未做大规模调用）。
5. 不同网络环境下 `TypeError` 失败率是否一致。

## 9. 数据时间戳口径

- 界面顶部「拉取于」= 本次运行实际抓取注册表的时刻。
- 「最近更新」= 官方 `community-plugin-stats.json` 中该插件的 `updated` 字段，**由上游决定更新频率，不代表当前时刻真实状态**。
- 页脚构建时间 = 该 HTML 产物的构建时刻，与数据无关。
