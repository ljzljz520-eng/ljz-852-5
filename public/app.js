// 补丁索引站前端逻辑
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  facets: { osVersions: [], types: [] },
  page: 1,
  debounceTimer: null,
};

const TYPE_ORDER = ['安全更新', '累积更新', '功能更新', '服务堆栈更新', '驱动更新', '紧急补丁', '语言包', '其他'];

// ---------- 工具 ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function debounce(fn, ms = 350) {
  clearTimeout(state.debounce);
  state.debounceTimer = setTimeout(fn, ms);
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function debounceWait(fn, ms) {
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(fn, ms);
}
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---------- 路由 ----------
function route() {
  const name = location.hash.replace('#/', '') || 'search';
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  ['search', 'import', 'admin'].forEach((n) => {
    $('#page-' + n).hidden = n !== name;
  });
  if (name === 'admin') loadHotwords();
}
window.addEventListener('hashchange', route);

// ---------- 过滤条件读取 ----------
function collectParams() {
  const q = $('#q').value.trim();
  const osVals = $$('#f-osversions input:checked').map((c) => c.value);
  const typeVals = $$('#f-types input:checked').map((c) => c.value);
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (osVals.length) p.set('osVersions', osVals.join(','));
  if (typeVals.length) p.set('types', typeVals.join(','));
  const df = $('#f-date-from').value;
  const dt = $('#f-date-to').value;
  if (df) p.set('dateFrom', df);
  if (dt) p.set('dateTo', dt);
  const sz = $('#f-size select') ? null : null;
  const sizeSel = $('#f-size');
  if (sizeSel.value) {
    const [lo, hi] = sizeSel.value.split('-');
    if (lo) p.set('minSizeBytes', lo);
    if (hi) p.set('maxSizeBytes', hi);
  }
  p.set('sort', $('#f-sort').value);
  if (state.page > 1) p.set('page', state.page);
  return p;
}

// ---------- 搜索执行 ----------
async function doSearch() {
  const meta = $('#result-meta');
  const list = $('#result-list');
  list.innerHTML = '<div class="empty">🔍 正在从搜索引擎获取结果…</div>';
  $('#pagination').innerHTML = '';
  try {
    const data = await api('/api/patches?' + collectParams().toString());
    renderResults(data);
  } catch (e) {
    list.innerHTML = `<div class="empty">查询失败：${esc(e.message)}<br>请确认 Meilisearch 服务已启动。</div>`;
    meta.textContent = '';
  }
}

function renderResults(data) {
  const meta = $('#result-meta');
  if (data.query) {
    meta.innerHTML = `关键词 <b>“${esc(data.query)}”</b> 命中 <b>${data.hits}</b> 条补丁 · 引擎耗时 ${data.processingTimeMs} ms · 第 ${data.page}/${data.totalPages} 页`;
  } else {
    meta.innerHTML = `共 <b>${data.hits}</b> 条补丁 · 第 ${data.page}/${data.totalPages} 页`;
  }
  const list = $('#result-list');
  if (!data.items.length) {
    list.innerHTML = '<div class="empty">😿 没有匹配的补丁，试试放宽过滤条件或更换关键词。</div>';
    $('#pagination').innerHTML = '';
    return;
  }
  list.innerHTML = data.items.map((d) => {
    const name = d._formatted?.name ?? d.name;
    const summary = d._formatted?.summary ?? d.summary;
    return `<article class="patch-card">
      <h3>${name}</h3>
      <div class="badges">
        <span class="badge os">${esc(d.osVersion)}</span>
        <span class="badge type-${esc(d.type)}">${esc(d.type)}</span>
        ${d.kbId ? `<span class="badge" style="background:#f1f5f9;color:#334155">${esc(d.kbId)}</span>` : ''}
      </div>
      <p class="summary">${summary}</p>
      <div class="metrics">
        <span>📦 文件 <b>${d.fileCount}</b> 个</span>
        <span>💾 大小 <b>${esc(d.sizeText)}</b></span>
        <span>🗓️ 发布于 <b>${d.releasedDate}</b></span>
      </div>
    </article>`;
  }).join('');
  renderPagination(data);
}

function renderPagination(data) {
  if (data.totalPages <= 1) { $('#pagination').innerHTML = ''; return; }
  const cur = data.page;
  const pages = new Set([1, 2, data.totalPages - 1, data.totalPages, cur, cur - 1, cur + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= data.totalPages).sort((a, b) => a - b);
  let html = `<button ${cur === 1 ? 'disabled' : ''} data-p="${cur - 1}">‹ 上一页</button>`;
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) html += '<span style="padding:6px 4px;color:#94a3b8">…</span>';
    html += `<button class="${p === cur ? 'active' : ''}" data-p="${p}">${p}</button>`;
    prev = p;
  }
  html += `<button ${cur === data.totalPages ? 'disabled' : ''} data-p="${cur + 1}">下一页 ›</button>`;
  $('#pagination').innerHTML = html;
  $$('#pagination button[data-p]').forEach((b) => b.addEventListener('click', () => {
    state.page = Number(b.dataset.p);
    doSearch();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

// ---------- 过滤器 UI ----------
async function initFilters() {
  try {
    const [facets, ov] = await Promise.all([api('/api/facets'), api('/api/overview')]);
    state.facets = facets;
    renderOsChecks(facets.osVersions);
    renderTypeChecks(facets.types);
    $('#result-meta').innerHTML = `已索引 <b>${ov.totalDocuments}</b> 条补丁数据`;
  } catch (e) {
    $('#f-osversions').innerHTML = `<div class="muted">过滤器加载失败：${esc(e.message)}</div>`;
  }
}

function renderOsChecks(list) {
  $('#f-osversions').innerHTML = list.map((f) =>
    `<label><input type="checkbox" value="${esc(f.value)}">${esc(f.value)}<span class="cnt">${f.count}</span></label>`
  ).join('') || '<div class="muted">暂无数据，请先导入</div>';
}
function renderTypeChecks(list) {
  const countMap = Object.fromEntries(list.map((f) => [f.value, f.count]));
  const ordered = TYPE_ORDER.map((t) => ({ value: t, count: countMap[t] || 0 })).filter((x) => x.count > 0);
  $('#f-types').innerHTML = ordered.map((f) =>
    `<label><input type="checkbox" value="${esc(f.value)}">${esc(f.value)}<span class="cnt">${f.count}</span></label>`
  ).join('') || '<div class="muted">暂无数据</div>';
}

// 过滤器变化 -> 回到第 1 页并搜索
function bindFilters() {
  $('#f-osversions').addEventListener('change', onFilterChange);
  $('#f-types').addEventListener('change', onFilterChange);
  $('#f-date-from').addEventListener('change', onFilterChange);
  $('#f-date-to').addEventListener('change', onFilterChange);
  $('#f-size').addEventListener('change', onFilterChange);
  $('#f-sort').addEventListener('change', onFilterChange);

  $$('.quick-dates button').forEach((b) => b.addEventListener('click', () => {
    const days = Number(b.dataset.days);
    const to = new Date();
    const from = new Date(Date.now() - days * 86400000);
    $('#f-date-from').value = from.toISOString().slice(0, 10);
    $('#f-date-to').value = to.toISOString().slice(0, 10);
    onFilterChange();
  }));

  $('#reset-filters').addEventListener('click', () => {
    $$('#f-osversions input, #f-types input').forEach((c) => (c.checked = false));
    $('#f-date-from').value = '';
    $('#f-date-to').value = '';
    $('#f-size').value = '';
    $('#f-sort').value = 'time_desc';
    onFilterChange();
  });
}
function onFilterChange() { state.page = 1; debounceWait(doSearch, 250); }

// ---------- 搜索框 & 热词建议 ----------
function bindSearch() {
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.page = 1;
    doSearch();
  });
  // 输入即搜（搜索引擎支持前缀匹配）
  $('#q').addEventListener('input', () => { state.page = 1; debounceWait(doSearch, 350); });
}
async function loadHotSuggestions() {
  try {
    const hw = await api('/api/admin/hotwords?limit=8');
    if (!hw.top.length) return;
    const tags = hw.top.map((w) => `<span class="tag" data-w="${esc(w.word)}">🔥 ${esc(w.word)} <small>×${w.count}</small></span>`).join('');
    $('#hot-suggest').innerHTML = `<span>大家在搜：</span>${tags}`;
    $$('#hot-suggest .tag').forEach((t) => t.addEventListener('click', () => {
      $('#q').value = t.dataset.w;
      state.page = 1;
      doSearch();
    }));
  } catch { /* 忽略 */ }
}

// ---------- 导入页 ----------
function bindImport() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $('#tab-upload').hidden = t.dataset.tab !== 'upload';
    $('#tab-paste').hidden = t.dataset.tab !== 'paste';
  }));

  $('#btn-upload').addEventListener('click', async () => {
    const file = $('#file-input').files[0];
    if (!file) return reportImport('<div class="report err">请先选择 CSV 或 JSON 文件。</div>');
    const content = await file.text();
    const format = file.name.endsWith('.json') ? 'json' : 'csv';
    await sendImport({ format, content });
  });

  $('#btn-paste').addEventListener('click', async () => {
    const content = $('#paste-content').value.trim();
    if (!content) return reportImport('<div class="report err">内容为空。</div>');
    await sendImport({ format: $('#paste-format').value, content });
  });
}

async function sendImport(body) {
  body.mode = $$('input[name=mode]:checked')[0]?.value || 'upsert';
  $('#import-report').innerHTML = '<div class="muted">正在写入搜索引擎…</div>';
  try {
    const r = await api('/api/import', { method: 'POST', body: JSON.stringify(body) });
    let html = `<div class="report ok">✅ 导入完成：成功 <b>${r.inserted}</b> 条${r.errors.length ? `，校验失败 <b>${r.errors.length}</b> 行` : ''}。</div>`;
    if (r.errors.length) {
      html += '<div class="report err"><b>失败明细：</b><ul>' +
        r.errors.slice(0, 15).map((e) => `<li>第 ${e.row} 行「${esc(e.name)}」：${esc(e.problems.join('；'))}</li>`).join('') +
        (r.errors.length > 15 ? `<li>…另有 ${r.errors.length - 15} 行</li>` : '') + '</ul></div>';
    }
    reportImport(html);
    initFilters();
    loadHotSuggestions();
  } catch (e) {
    reportImport(`<div class="report err">导入失败：${esc(e.message)}</div>`);
  }
}
function reportImport(html) { $('#import-report').innerHTML = html; }

// ---------- 热词后台 ----------
async function loadHotwords() {
  try {
    const withZero = $('#hw-zero').checked ? '1' : '0';
    const hw = await api(`/api/admin/hotwords?limit=50&withZero=${withZero}`);
    $('#hw-stats').innerHTML = `
      <div class="stat"><b>${hw.stats.totalSearches}</b><span>搜索总次数</span></div>
      <div class="stat"><b>${hw.stats.distinctWords}</b><span>不重复热词</span></div>
      <div class="stat"><b>${hw.stats.zeroResultWords}</b><span>零结果热词</span></div>`;
    $('#hw-body').innerHTML = hw.top.map((w, i) => `<tr>
      <td class="rank">${i + 1}</td>
      <td class="word">🔥 ${esc(w.word)}</td>
      <td>${w.count}</td>
      <td class="${w.lastResultCount === 0 ? 'zero' : ''}">${w.lastResultCount}</td>
      <td>${new Date(w.lastAt).toLocaleString('zh-CN')}</td>
      <td><button data-del="${esc(w.word)}">删除</button></td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">暂无搜索记录</td></tr>';
    $$('#hw-body button[data-del]').forEach((b) => b.addEventListener('click', async () => {
      await api('/api/admin/hotwords/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
      loadHotwords();
    }));
  } catch (e) {
    $('#hw-body').innerHTML = `<tr><td colspan="6" class="zero">加载失败：${esc(e.message)}</td></tr>`;
  }
}

function bindAdmin() {
  $('#hw-refresh').addEventListener('click', loadHotwords);
  $('#hw-zero').addEventListener('change', loadHotwords);
  $('#hw-clear').addEventListener('click', async () => {
    if (!confirm('确定清空全部热词记录？')) return;
    await api('/api/admin/hotwords', { method: 'DELETE' });
    loadHotwords();
  });
}

// ---------- 启动 ----------
route();
initFilters();
bindFilters();
bindSearch();
bindImport();
bindAdmin();
loadHotSuggestions();
doSearch();
