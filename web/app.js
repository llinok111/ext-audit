/* 应用主逻辑。依赖被内联到同一作用域的模块函数。 */
/* global loadSources, toRecord, verifyRecord, search, describeCoverage, pool, runChecks, summarize, checkCompatibility, licenseClass */

const $ = (id) => document.getElementById(id);

const state = {
  bundle: null,
  coverage: null,
  records: [],          // 全量记录（含未核验）
  verified: new Map(),  // id -> 已核验记录
  query: '',
  licenseFilter: '',
  stateFilter: '',
  hideRemoved: false,
  selectedId: null,
  appVersion: '1.14.5',
  results: [],
  verifying: false,
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtNum = (n) => (n === null || n === undefined ? null : n.toLocaleString('zh-CN'));

function fmtDate(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function relDays(ms) {
  if (!ms) return null;
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${(days / 365).toFixed(1)} 年前`;
}

/* ---------------- 数据加载 ---------------- */

async function boot() {
  try {
    const bundle = await loadSources({ timeoutMs: 20000, retries: 3 });
    state.bundle = bundle;
    state.coverage = describeCoverage(bundle);
    state.records = bundle.registry.map((e) => toRecord(e, bundle));
    renderFreshness();
    renderFoot();
    renderResults();
  } catch (err) {
    $('freshDot').className = 'dot failed';
    $('freshText').textContent = `数据源加载失败：${err.message}`;
    $('listMeta').textContent = '加载失败';
    $('detail').innerHTML = `<div class="empty">
      <div class="big">无法加载官方注册表</div>
      <div>${esc(err.message)}</div>
      <div style="max-width:520px;margin-top:10px">本工具不内置数据快照（官方仓库未声明许可证，不在包内重新分发数据集），因此必须联网读取。请检查网络后重试。</div>
      <button class="btn primary" style="margin-top:14px" onclick="location.reload()">重试</button>
    </div>`;
  }
}

function renderFreshness() {
  const cov = state.coverage;
  const anyFail = cov.states.some((s) => s.state !== 'ok');
  $('freshDot').className = 'dot' + (anyFail ? ' stale' : '');
  $('freshText').innerHTML =
    `注册表 ${fmtNum(cov.registryCount)} 条 · 拉取于 ${esc(fmtDate(cov.fetchedAt))}` +
    (anyFail ? ` · <span style="color:var(--c-warn)">${cov.states.filter((s) => s.state !== 'ok').length} 个源未取到</span>` : '');
}

function renderFoot() {
  const cov = state.coverage;
  $('footData').textContent =
    `数据源：官方 obsidian-releases（注册表 ${fmtNum(cov.registryCount)} · 统计 ${fmtNum(cov.statsCount)} · 下架 ${fmtNum(cov.removedCount)}）`;
}

/* ---------------- 结果列表 ---------------- */

function currentPool() {
  let pool = state.records;
  if (state.hideRemoved) pool = pool.filter((r) => !r.removedEntry);
  if (state.stateFilter) {
    pool = pool.filter((r) => {
      const v = state.verified.get(r.id);
      if (state.stateFilter === 'unverified') return !v;
      return v && v.status === state.stateFilter;
    });
  }
  if (state.licenseFilter) {
    pool = pool.filter((r) => {
      const v = state.verified.get(r.id);
      const spdx = v?.license?.detection?.spdx || null;
      if (state.licenseFilter === 'unknown') return !spdx;
      return spdx === state.licenseFilter;
    });
  }
  return pool;
}

function renderResults() {
  const pool = currentPool();
  const hits = search(pool, state.query, { limit: 200, includeRemoved: true });
  state.results = hits;

  const verifiedCount = state.verified.size;
  $('listMeta').textContent =
    `${hits.length} 条结果 / 共 ${fmtNum(pool.length)} 条` +
    (verifiedCount ? ` · 已核验 ${verifiedCount}` : '') +
    (state.query ? ` · 查询「${state.query}」` : '');

  const rows = hits
    .map(({ record, matched }) => {
      const v = state.verified.get(record.id);
      const status = v ? v.status : 'unverified';
      const badge =
        status === 'unverified'
          ? '<span class="badge neutral">未核验</span>'
          : `<span class="badge ${status}">${status}</span>`;
      const lic = v?.license?.detection?.spdx;
      const metaBits = [
        record.repo ? esc(record.repo) : null,
        v?.version ? `v${esc(v.version)}` : null,
        lic ? esc(lic) : null,
        record.downloads !== null ? `${fmtNum(record.downloads)} 下载` : '下载量未知',
      ].filter(Boolean);
      const matchedTxt = matched?.length
        ? matched.map((m) => `${m.field}:${m.kind}`).join(' · ')
        : '';
      return `<button class="row ${record.id === state.selectedId ? 'active' : ''}" data-id="${esc(record.id)}">
        <div class="rname">${esc(record.name || record.id)} ${badge}</div>
        <div class="rmeta">${metaBits.join(' · ')}</div>
        ${record.description ? `<div class="rdesc">${esc(record.description)}</div>` : '<div class="rdesc">（注册表未提供描述）</div>'}
        ${matchedTxt ? `<div class="matched">命中 ${esc(matchedTxt)}</div>` : ''}
      </button>`;
    })
    .join('');

  $('rows').innerHTML = rows || `<div class="empty" style="height:200px"><div>没有匹配项</div></div>`;

  $('rows').querySelectorAll('.row').forEach((el) => {
    el.addEventListener('click', () => selectRecord(el.dataset.id));
  });

  if (state.selectedId && !hits.find((h) => h.record.id === state.selectedId)) {
    // 选中项被筛掉时不强改视图，避免打断阅读
  }
}

function selectRecord(id) {
  state.selectedId = id;
  renderResults();
  renderDetail();
}

/* ---------------- 详情 ---------------- */

const LVL_LABEL = { info: 'info', warn: 'warn', fail: 'fail', unknown: '未知' };

function kv(label, value, opts = {}) {
  const { mono = false, empty = '未提供' } = opts;
  if (value === null || value === undefined || value === '') {
    return `<dt>${esc(label)}</dt><dd class="none">${esc(empty)}</dd>`;
  }
  return `<dt>${esc(label)}</dt><dd class="${mono ? 'mono' : ''}">${value}</dd>`;
}

function renderDetail() {
  const id = state.selectedId;
  const record = state.records.find((r) => r.id === id);
  if (!record) return;
  const v = state.verified.get(id);
  const el = $('detail');

  const status = v ? v.status : 'unverified';
  const statusBadge =
    status === 'unverified'
      ? '<span class="badge neutral">未核验</span>'
      : `<span class="badge ${status}">${status}</span>`;

  const licDet = v?.license?.detection;
  const licBadge = (() => {
    if (!v) return '<span class="badge neutral">未核验</span>';
    if (v.license?.status === 'unknown') return '<span class="badge unknown">未确定</span>';
    if (v.license?.status === 'missing') return '<span class="badge warn">仓库无许可证文件</span>';
    if (licDet?.confidence === 'matched') {
      const cls = licenseClass(licDet.spdx);
      return `<span class="badge ok">${esc(licDet.spdx)}</span> <span class="badge neutral">${esc(cls.label)}</span>`;
    }
    if (licDet?.confidence === 'ambiguous') return '<span class="badge warn">特征冲突</span>';
    return '<span class="badge warn">无法识别</span>';
  })();

  // 兼容性：三态，绝不把未确定写成可用
  let compatHtml = '<span class="badge neutral">未核验</span>';
  let compatReason = '';
  if (v) {
    const c = checkCompatibility({
      minAppVersion: v.minAppVersion,
      appVersion: state.appVersion,
      versionsMap: v.versionsMap,
      pluginVersion: v.version,
    });
    const map = {
      compatible: '<span class="badge ok">版本满足</span>',
      incompatible: c.hasFallback
        ? '<span class="badge warn">需回退版本</span>'
        : '<span class="badge fail">不兼容</span>',
      undetermined: '<span class="badge unknown">未确定</span>',
    };
    compatHtml = map[c.verdict];
    compatReason = c.reason;
  }

  const checksHtml = v
    ? v.checks
        .map(
          (c) => `<div class="check">
        <span class="lvl ${c.level}">${esc(LVL_LABEL[c.level] || c.level)}</span>
        <div class="body">
          <div class="ctitle">${esc(c.title)}${c.advisory ? ' <span class="badge neutral" style="font-size:10px">常驻声明</span>' : ''}</div>
          <div class="cdetail">${esc(c.detail)}</div>
          ${c.basis ? `<div class="cbasis">${esc(typeof c.basis === 'string' ? c.basis : JSON.stringify(c.basis, null, 1))}</div>` : ''}
        </div>
      </div>`,
        )
        .join('')
    : '<div class="notice">尚未深度核验。点击右上「深度核验当前结果」，或核验此单项，才会读取该仓库的 manifest.json、versions.json 与许可证原文。</div>';

  const versionsHtml =
    v && v.knownVersions?.length
      ? esc(v.knownVersions.slice(-12).join(', ')) + (v.knownVersions.length > 12 ? ` …共 ${v.knownVersions.length} 个` : '')
      : v
        ? '（下载统计中无版本记录）'
        : '未核验';

  el.innerHTML = `
    <div class="d-head">
      <div>
        <div class="d-title">${esc(record.name || record.id)}</div>
        <div class="d-id">${esc(record.id)}</div>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${statusBadge}${licBadge}
      </div>
    </div>

    <p class="d-desc">${record.description ? esc(record.description) : '<span style="color:var(--c-ink-3)">（注册表未提供描述）</span>'}</p>

    ${v && v.status !== 'ok' ? `<div class="notice" style="margin-top:14px">
      本次判定为 <strong style="color:var(--c-ink)">${esc(v.status)}</strong>。
      ${v.status === 'unknown' ? '其中包含未确定的检查项（多为网络受限导致），不代表该插件有问题，请重试以获得结论。' : ''}
      ${v.status === 'fail' ? '存在确定的失效或不一致信号，详见下方检查明细。' : ''}
      ${v.status === 'warn' ? '存在已确认的瑕疵（如缺少许可证文件），但不构成失效。' : ''}
    </div>` : ''}

    <section class="block">
      <h3>元数据</h3>
      <dl class="kv">
        ${kv('名称', esc(record.name || ''))}
        ${kv('插件 ID', esc(record.id || ''), { mono: true })}
        ${kv('作者', esc(record.author || ''))}
        ${kv('仓库', record.repo ? `<a href="https://github.com/${esc(record.repo)}" target="_blank" rel="noopener">${esc(record.repo)}</a>` : null, { mono: true })}
        ${kv('下载量', record.downloads !== null ? fmtNum(record.downloads) : null, { empty: '统计中无记录' })}
        ${kv('最近更新', record.updatedAt ? `${fmtDate(record.updatedAt)}（${relDays(record.updatedAt)}）` : null, { empty: '统计中无记录' })}
        ${kv('仅桌面端', v ? (v.isDesktopOnly ? '是' : '否') : null, { empty: '未核验' })}
      </dl>
    </section>

    <section class="block">
      <h3>版本与兼容性</h3>
      <dl class="kv">
        ${kv('当前版本', v?.version ? esc(v.version) : null, { mono: true, empty: '未核验' })}
        ${kv('最低应用版本', v?.minAppVersion ? esc(v.minAppVersion) : null, { mono: true, empty: '未核验或未声明' })}
        ${kv('你的版本', esc(state.appVersion || '（未填写）'), { mono: true })}
        ${kv('兼容判定', compatHtml + (compatReason ? ` <span style="color:var(--c-ink-3);font-size:12px">— ${esc(compatReason)}</span>` : ''))}
        ${kv('历史版本', versionsHtml, { mono: true })}
      </dl>
      <div class="notice" style="margin-top:10px">
        「版本满足」仅表示插件声明的 <code>minAppVersion</code> 不高于你填写的版本，是<strong>声明层面的比较</strong>，
        不等于实测可用。未填写版本时不作任何推断。
      </div>
    </section>

    <section class="block">
      <h3>许可证</h3>
      <dl class="kv">
        ${kv('识别结果', licBadge)}
        ${kv('判定依据', licDet?.note ? esc(licDet.note) : null, { empty: v?.license?.status === 'missing' ? '仓库未提供许可证文件' : '未核验' })}
        ${kv('文件名', v?.license?.file ? esc(v.license.file) : null, { mono: true, empty: v ? '—' : '未核验' })}
        ${kv('原文链接', v?.license?.url ? `<a href="${esc(v.license.url)}" target="_blank" rel="noopener">${esc(v.license.url)}</a>` : null, { empty: '—' })}
      </dl>
      ${v?.license?.text ? `<div class="lic-text" style="margin-top:10px">${esc(v.license.text.slice(0, 1200))}</div>` : ''}
      ${licDet?.evidence?.length ? `<div class="cbasis" style="margin-top:8px">命中特征：\n${esc(licDet.evidence.join('\n'))}</div>` : ''}
    </section>

    <section class="block">
      <h3>基础检查（${v ? v.checks.filter((c) => !c.advisory).length + ' 项可判定 · ' + v.checks.filter((c) => c.advisory).length + ' 项常驻声明' : '未运行'}）</h3>
      ${checksHtml}
    </section>

    <section class="block">
      <h3>来源</h3>
      <dl class="kv">
        ${kv('注册表条目', record.sources.registry ? `<a href="${esc(record.sources.registry)}" target="_blank" rel="noopener">${esc(record.sources.registry)}</a>` : null, { mono: true })}
        ${kv('manifest.json', record.sources.manifest ? `<a href="${esc(record.sources.manifest)}" target="_blank" rel="noopener">${esc(record.sources.manifest)}</a>` : null, { mono: true })}
        ${kv('versions.json', v?.sources?.versions ? `<a href="${esc(v.sources.versions)}" target="_blank" rel="noopener">${esc(v.sources.versions)}</a>` : null, { mono: true, empty: v ? '该仓库无此文件' : '未核验' })}
        ${kv('下载统计', `<a href="${esc(record.sources.stats)}" target="_blank" rel="noopener">${esc(record.sources.stats)}</a>`, { mono: true })}
        ${record.removedEntry ? kv('官方下架记录', `原因：${esc(record.removedEntry.reason || '未说明')}`) : ''}
        ${record.deprecationEntry?.length ? kv('官方弃用版本', esc(record.deprecationEntry.join(', ')), { mono: true }) : ''}
      </dl>
    </section>

    <div style="margin-top:22px">
      <button class="btn" id="verifyOne">${v ? '重新核验此插件' : '核验此插件'}</button>
    </div>
  `;

  $('verifyOne').addEventListener('click', () => verifyOne(id));
}

/* ---------------- 核验 ---------------- */

async function verifyOne(id) {
  const record = state.records.find((r) => r.id === id);
  if (!record) return;
  $('verifyOne') && ($('verifyOne').disabled = true);
  const btn = $('verifyOne');
  if (btn) btn.innerHTML = '<span class="spinner"></span> 核验中…';

  const v = await verifyRecord(record, { timeoutMs: 20000, retries: 2 });
  // 展开顺序必须是 record 在前、v 在后：v 带回了 repoStatus / version 等核验结果，
  // 若写反，record 的 repoStatus='unchecked' 会把这些结果覆盖掉（此缺陷已实测抓出）。
  const merged = { ...record, ...v };
  const checks = runChecks(merged, { appVersion: state.appVersion });
  merged.checks = checks;
  merged.status = summarize(checks);
  state.verified.set(id, merged);
  renderResults();
  renderDetail();
}

async function verifyAll() {
  if (state.verifying) return;
  const targets = state.results.slice(0, 60).map((h) => h.record);
  if (!targets.length) return;
  state.verifying = true;
  $('verifyAll').disabled = true;

  let done = 0;
  const meta = $('listMeta');

  await pool(
    targets,
    async (record) => {
      const v = await verifyRecord(record, { timeoutMs: 20000, retries: 2 });
      const merged = { ...record, ...v };
      const checks = runChecks(merged, { appVersion: state.appVersion });
      merged.checks = checks;
      merged.status = summarize(checks);
      state.verified.set(record.id, merged);
      done += 1;
      meta.textContent = `核验中 ${done}/${targets.length}…（每个插件需读取 manifest 与许可证原文）`;
      return null;
    },
    4,
  );

  state.verifying = false;
  $('verifyAll').disabled = false;
  renderResults();
  renderDetail();
}

/* ---------------- 局限说明 ---------------- */

function renderLimits() {
  const cov = state.coverage;
  $('limitsBody').innerHTML = `
    <div style="margin-bottom:16px;font-family:var(--mono);font-size:12px;color:var(--c-ink-3)">
      数据拉取时间：${esc(fmtDate(cov.fetchedAt))}　|　注册表 ${fmtNum(cov.registryCount)} 条　|　统计 ${fmtNum(cov.statsCount)} 条　|　下架 ${fmtNum(cov.removedCount)} 条
    </div>
    <h3 style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--c-ink-3);margin:0 0 10px">各数据源状态</h3>
    ${cov.states
      .map(
        (s) => `<div class="src-row">
        <span class="badge ${s.state === 'ok' ? 'ok' : s.state === 'missing' ? 'warn' : 'unknown'}">${esc(s.state)}</span>
        <span style="flex:1">${esc(s.label)}${s.reason ? `　<span style="color:var(--c-warn)">${esc(s.reason)}</span>` : ''}</span>
        <a href="${esc(s.url)}" target="_blank" rel="noopener" style="font-size:11px">源</a>
      </div>`,
      )
      .join('')}
    <h3 style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--c-ink-3);margin:20px 0 10px">局限</h3>
    <ul>${cov.limitations.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    <h3 style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--c-ink-3);margin:20px 0 10px">关于数据再分发</h3>
    <ul>
      <li>官方 obsidian-releases 仓库未声明许可证（LICENSE 文件 404，GitHub license API 亦返回 404）。因此本工具<strong>不在安装包内附带任何数据快照</strong>，全部数据在运行时从官方地址读取，仅缓存在当前浏览器会话中。</li>
      <li>插件自身的许可证各自独立，需以各仓库 LICENSE 原文为准；本工具的识别结果仅为文本特征匹配，不构成法律意见。</li>
    </ul>
  `;
}

/* ---------------- 事件绑定 ---------------- */

let debounce;
$('q').addEventListener('input', (e) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    state.query = e.target.value;
    renderResults();
  }, 140);
});

$('appVer').addEventListener('input', (e) => {
  state.appVersion = e.target.value.trim();
  if (state.selectedId) renderDetail();
});

$('fLic').addEventListener('change', (e) => {
  state.licenseFilter = e.target.value;
  renderResults();
});
$('fState').addEventListener('change', (e) => {
  state.stateFilter = e.target.value;
  renderResults();
});
$('toggleRemoved').addEventListener('click', (e) => {
  state.hideRemoved = !state.hideRemoved;
  e.target.textContent = state.hideRemoved ? '显示已下架' : '隐藏已下架';
  renderResults();
});
$('verifyAll').addEventListener('click', verifyAll);

$('openLimits').addEventListener('click', () => {
  if (state.coverage) renderLimits();
  $('limitsDlg').showModal();
});
$('closeLimits').addEventListener('click', () => $('limitsDlg').close());

boot();
