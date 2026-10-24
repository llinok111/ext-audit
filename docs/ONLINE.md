# 线上验证记录

> 验证时间：2026-10-24 21:40–21:55　目标：<https://llinok111.github.io/ext-audit/>

## 1. 部署链路

| 步骤 | 结果 |
|---|---|
| 仓库创建 | `llinok111/ext-audit`（public） |
| 推送通道 | `git@github-llinok111` → `ssh.github.com:443`（https 通道在本机不可用） |
| Pages 站点 | `build_type=workflow`，`html_url=https://llinok111.github.io/ext-audit/` |
| 工作流 | `.github/workflows/pages.yml`，运行 **success**（22s） |

### 一个时序坑

首次 push 触发的工作流**失败**：

```
##[error]Get Pages site failed. Please verify that the repository has Pages enabled
and configured to build using GitHub Actions...
Error: Not Found - https://docs.github.com/rest/pages/pages#get-a-apiname-pages-site
```

原因：push 触发的运行早于 Pages 站点的创建。处置顺序必须是：

1. 先 `POST /repos/<owner>/<repo>/pages`（`{"build_type":"workflow"}`）
2. 再 `gh workflow run pages.yml`

之后 push 即可正常自动触发。

## 2. 产物一致性

CI 会在部署前**重新构建**界面（`node tools/build-web.mjs`），因此线上产物与仓库提交的构建结果需比对。

```
线上（--compressed 解压后）：68,055 B
本地构建产物：              68,055 B
sha256：不同
```

差异仅来自构建时间戳。归一化后逐字节一致：

```
diff <(sed 's/构建 20[0-9-]*T[0-9:.]*Z/构建 BUILD/g' live.html) \
     <(sed 's/构建 20[0-9-]*T[0-9:.]*Z/构建 BUILD/g' local.html)
→ 逐字节一致
```

说明线上发布的是仓库源码的真实构建结果，不存在陈旧产物。

## 3. 运行时数据拉取

线上页面在真实浏览器（Chrome headless）中加载后的 DOM 实测：

```
DOM 字节：130,026
列表渲染行数：201
注册表计数：9,410 条
拉取时间：2026-10-24 21:53
```

**关键点**：注册表条数为 **9,410**，而当天 16:24 抓取时为 **9,389** 条，多出 21 条。这证明页面读取的是**实时上游数据**，而非任何内置快照——与「包内不含数据快照」的设计一致。

## 4. 一处需澄清的误报

用 `--dump-dom` 检索「无法加载官方注册表」时命中 1 处，但定位后确认：

```
上下文位于 <script> 内的错误分支模板字符串：
  $('detail').innerHTML = `<div class="empty">
      <div class="big">无法加载官方注册表</div> ...
```

即该字符串只存在于内联 JS 源码中，**不是渲染出的 DOM**。页面实际状态为正常加载（201 行、9410 条）。

判定方法：先看出现位置是否在 `<script>` 内，再看渲染后的实际节点。仅靠全文检索会误判。

## 5. 线上可访问性

```
GET https://llinok111.github.io/ext-audit/  → 200
<title>扩展发现与核验台 · Obsidian 社区插件</title>
含品牌名：true
含安全基线声明：true
含数据源域名：true
```

## 6. 已知限制

- 演示页依赖浏览器直连 `raw.githubusercontent.com`（该域名返回 `Access-Control-Allow-Origin: *`，无需代理）。
- 在受限网络下首次加载可能较慢或需重试，页面顶部会显示各数据源的实际状态。
- 「深度核验当前结果」会逐个读取插件仓库的 `manifest.json` 与 `LICENSE` 原文，速度取决于网络，单次最多核验 60 项。
