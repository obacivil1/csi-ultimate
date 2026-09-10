// ── State ──
let isRunning = false;
let results = [];
let eventSource = null;
let generatedKeywords = [];

// ── DOM ──
const $ = (id) => document.getElementById(id);
const API_BASE = '';

// ── Toast ──
function showToast(msg, type = 'info') {
  const container = $('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

// ── Advanced Toggle ──
function toggleAdvanced() {
  $('advancedOptions').classList.toggle('open');
  $('advancedArrow').classList.toggle('open');
}

// ── Logging ──
function addLog(text, type = 'info') {
  const container = $('logContainer');
  const empty = container.querySelector('.log-empty');
  if (empty) container.innerHTML = '';

  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = text;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;

  $('logCount').textContent = `${container.querySelectorAll('.log-line').length} lines`;
}

// ── Keyword Generation ──
async function generateKeywordTags(input) {
  if (!input || input.length < 2) {
    $('keywordTags').style.display = 'none';
    return;
  }
  try {
    const resp = await fetch(`${API_BASE}/api/keywords/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    });
    const data = await resp.json();
    if (data.keywords && data.keywords.length > 0) {
      generatedKeywords = data.keywords;
      renderKeywordTags(data.keywords);
      $('keywordTags').style.display = 'block';
    }
  } catch (e) { /* ignore */ }
}

function renderKeywordTags(keywords) {
  const container = $('keywordTagList');
  container.innerHTML = '';
  for (const kw of keywords) {
    const tag = document.createElement('span');
    tag.className = 'kw-tag';
    tag.textContent = kw;
    container.appendChild(tag);
  }
}

// ── Results ──
function addResults(rows) {
  results = results.concat(rows);
  renderResults();
}

function renderResults() {
  const container = $('resultsContainer');
  if (results.length === 0) {
    container.innerHTML = `<div class="results-empty"><div><div class="icon">📊</div><p>لا توجد نتائج</p></div></div>`;
    $('resultCount').textContent = '0';
    return;
  }

  const cols = ['title', 'url', 'matched', 'price', 'location', 'date', 'source', 'description'];
  let html = '<table class="results-table"><thead><tr>';
  for (const key of cols) {
    if (results.some(r => r[key] !== undefined && r[key] !== null && r[key] !== '')) {
      html += `<th>${key}</th>`;
    }
  }
  html += '</tr></thead><tbody>';

  for (const row of results) {
    html += '<tr>';
    for (const key of cols) {
      if (results.some(r => r[key] !== undefined && r[key] !== null && r[key] !== '')) {
        let val = row[key];
        if (val === undefined || val === null) val = '';
        val = String(val);
        if (key === 'url' && val) {
          val = `<a class="title-cell" href="${val}" target="_blank" title="${val.replace(/"/g, '&quot;')}">${truncate(val, 40)}</a>`;
        } else if (key === 'title' && val) {
          val = `<span class="title-cell">${truncate(val, 60)}</span>`;
        } else {
          val = truncate(val, 50);
        }
        html += `<td>${val}</td>`;
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;
  $('resultCount').textContent = String(results.length);
  enableExportButtons(true);
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function enableExportButtons(enabled) {
  $('btnExportExcel').disabled = !enabled;
  $('btnExportCSV').disabled = !enabled;
  $('btnExportJSON').disabled = !enabled;
}

// ── Parse JSON results from log lines ──
function tryParseResult(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && obj.title) return obj;
  } catch (e) { /* not JSON */ }

  const match = text.match(/\{.*"title".*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj.title) return obj;
    } catch (e) { /* ignore */ }
  }
  return null;
}

// ── Scrape Control ──
async function startScrape() {
  const url = $('inputUrl').value.trim();
  const search = $('inputSearch').value.trim();

  if (!url) {
    showToast('الرجاء إدخال رابط الموقع', 'error');
    return;
  }

  const config = {
    url,
    search,
    maxPages: parseInt($('inputMaxPages').value) || 10,
    maxAds: parseInt($('inputMaxAds').value) || 100,
    delay: parseInt($('inputDelay').value) || 2000,
    format: $('inputFormat').value || 'excel,json',
    visitPages: $('inputVisitPages').value === 'true',
    generateKeywords: $('inputAutoKeywords').value === 'true',
  };

  setRunning(true);
  results = [];
  renderResults();
  $('logContainer').innerHTML = '';
  $('logCount').textContent = '0 lines';
  enableExportButtons(false);

  const now = new Date().toLocaleString('ar-SA');
  addLog(`╔═══════════════════════════════════════════`, 'accent');
  addLog(`║ 🚀 CSI Job Hunter Pro — v10.0`, 'accent');
  addLog(`║ 📅 ${now}`, 'accent');
  addLog(`║ 🌐 ${url}`, 'accent');
  if (search) addLog(`║ 🔎 ${search}`, 'accent');
  addLog(`║ 📄 الصفحات: ${config.maxPages} | النتائج: ${config.maxAds}`, 'accent');
  addLog(`║ 🔍 زيارة الصفحات: ${config.visitPages ? 'نعم' : 'لا'}`, 'accent');
  addLog(`║ 🧠 توليد تلقائي: ${config.generateKeywords ? 'نعم' : 'لا'}`, 'accent');
  addLog(`╚═══════════════════════════════════════════`, 'accent');

  connectSSE();

  const resp = await fetch(`${API_BASE}/api/scrape/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const data = await resp.json();

  if (data.error) {
    showToast(data.error, 'error');
    setRunning(false);
    return;
  }
  addLog(`✅ تم بدء السحب`, 'success');
  setFooter(`🚀 جاري السحب من ${url}${search ? ' — ' + search : ''}`);
}

function stopScrape() {
  addLog('⏹ إيقاف العملية...', 'warn');
  fetch(`${API_BASE}/api/scrape/stop`, { method: 'POST' })
    .then(() => {
      addLog('⏹ تم الإيقاف', 'warn');
      setRunning(false);
      setFooter('⏹ متوقف');
      showToast('تم إيقاف السحب', 'warning');
      disconnectSSE();
    })
    .catch(() => {});
}

function clearAll() {
  if (isRunning) {
    showToast('أوقف العملية أولاً', 'warning');
    return;
  }
  results = [];
  $('logContainer').innerHTML = `<div class="log-empty"><div><div class="icon">🕸</div><p>أدخل رابط الموقع وكلمة البحث</p><p style="font-size:11px;color:var(--text-muted);margin-top:4px">ثم اضغط "بدء السحب" للبدء</p></div></div>`;
  $('logCount').textContent = '0 lines';
  renderResults();
  enableExportButtons(false);
  setFooter('✨ مستعد');
  showToast('تم المسح', 'info');
}

function setRunning(running) {
  isRunning = running;
  $('btnStart').disabled = running;
  $('btnStop').disabled = !running;
  $('statusText').textContent = running ? 'جاري السحب...' : 'جاهز';
  $('statusDot').className = `status-dot ${running ? 'running' : 'idle'}`;
}

function setFooter(text) {
  $('footerStatus').textContent = text;
}

// ── SSE ──
function connectSSE() {
  disconnectSSE();
  eventSource = new EventSource(`${API_BASE}/api/stream`);

  eventSource.addEventListener('connected', () => {
    addLog('🔗 متصل بالخادم', 'info');
  });

  eventSource.addEventListener('progress', (e) => {
    try {
      const data = JSON.parse(e.data);
      const lines = data.text.split('\n').filter(l => l.trim());
      for (const line of lines) {
        let type = 'info';
        const lower = line.toLowerCase();
        if (lower.includes('error') || lower.includes('fail') || lower.includes('❌')) type = 'error';
        else if (lower.includes('success') || lower.includes('✅') || lower.includes('found') || lower.includes('extracted')) type = 'success';
        else if (lower.includes('warn') || lower.includes('⚠️') || lower.includes('skip')) type = 'warn';
        else if (lower.includes('──') || lower.includes('══') || lower.includes('╔') || lower.includes('╚')) type = 'accent';
        else if (lower.includes('🧠') || lower.includes('learning')) type = 'accent';
        else if (lower.includes('debug') || lower.includes('trace')) type = 'muted';
        addLog(line, type);

        const result = tryParseResult(line);
        if (result) addResults([result]);
      }
    } catch (err) { /* ignore parse errors */ }
  });

  eventSource.addEventListener('result', (e) => {
    try {
      const item = JSON.parse(e.data);
      addResults([item]);
    } catch (err) { /* ignore */ }
  });

  eventSource.addEventListener('done', (e) => {
    const data = JSON.parse(e.data);
    addLog(`\n✅ اكتمل السحب بنجاح — ${data.count || 0} نتيجة`, 'success');
    setRunning(false);
    setFooter(`✅ مكتمل — ${results.length} نتيجة`);
    showToast(`✅ اكتمل! ${results.length} نتيجة`, 'success');
    $('statusDot').className = 'status-dot done';
    $('statusText').textContent = 'مكتمل';
    disconnectSSE();
    loadResults();
  });

  eventSource.addEventListener('error', (e) => {
    try {
      const data = JSON.parse(e.data || '{}');
      addLog(`\n❌ خطأ: ${data.message}`, 'error');
      setRunning(false);
      setFooter(`❌ ${data.message}`);
      showToast(`❌ ${data.message}`, 'error');
      $('statusDot').className = 'status-dot error';
      $('statusText').textContent = 'خطأ';
    } catch (err) { /* ignore */ }
    disconnectSSE();
  });

  eventSource.addEventListener('stopped', () => {
    disconnectSSE();
  });

  eventSource.onerror = () => {
    if (!isRunning) disconnectSSE();
  };
}

function disconnectSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

// ── Load saved results ──
async function loadResults() {
  try {
    const resp = await fetch(`${API_BASE}/api/results`);
    const data = await resp.json();
    if (data.files && data.files.length > 0) {
      const jsonFiles = data.files.filter(f => f.name.endsWith('.json'));
      if (jsonFiles.length > 0) {
        const latest = jsonFiles[0];
        const r = await fetch(`${API_BASE}/api/results/read?file=${encodeURIComponent(latest.name)}`);
        const rd = await r.json();
        if (rd.data) {
          const items = Array.isArray(rd.data) ? rd.data : (rd.data.ads || rd.data.results || []);
          if (items.length > 0) {
            results = items;
            renderResults();
            addLog(`📂 تم تحميل ${items.length} نتيجة من ${latest.name}`, 'info');
          }
        }
      }
    }
  } catch (e) { /* silent */ }
}

// ── Export ──
async function exportResults(format) {
  if (results.length === 0) {
    showToast('لا توجد نتائج للتصدير', 'warning');
    return;
  }

  const dataStr = JSON.stringify(results, null, 2);
  let blob, ext, mime;

  if (format === 'json') {
    blob = new Blob([dataStr], { type: 'application/json' });
    ext = 'json';
    mime = 'application/json';
  } else if (format === 'csv') {
    const csv = objectToCSV(results);
    blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    ext = 'csv';
    mime = 'text/csv';
  } else {
    blob = new Blob([dataStr], { type: 'application/json' });
    ext = 'json';
    mime = 'application/json';
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `csi-results-${Date.now()}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`✅ تم تصدير ${format.toUpperCase()}`, 'success');
}

function objectToCSV(arr) {
  if (!arr.length) return '';
  const keys = Object.keys(arr[0]);
  const rows = arr.map(row => keys.map(k => {
    const val = row[k];
    if (val === null || val === undefined) return '';
    const s = String(val).replace(/"/g, '""');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
  }).join(','));
  return [keys.join(','), ...rows].join('\n');
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !isRunning) {
      const active = document.activeElement;
      if (active && (active.id === 'inputUrl' || active.id === 'inputSearch')) {
        startScrape();
      }
    }
    if (e.key === 'Escape' && isRunning) {
      stopScrape();
    }
  });

  // Load saved inputs
  try {
    const lastUrl = localStorage.getItem('lastUrl');
    if (lastUrl) $('inputUrl').value = lastUrl;
    const lastSearch = localStorage.getItem('lastSearch');
    if (lastSearch) $('inputSearch').value = lastSearch;
  } catch (e) { /* ignore */ }

  $('inputUrl').addEventListener('change', () => {
    try { localStorage.setItem('lastUrl', $('inputUrl').value); } catch (e) { /* ignore */ }
  });
  $('inputSearch').addEventListener('change', () => {
    try { localStorage.setItem('lastSearch', $('inputSearch').value); } catch (e) { /* ignore */ }
  });

  // Auto-generate keywords on search input
  let kwDebounce = null;
  $('inputSearch').addEventListener('input', () => {
    clearTimeout(kwDebounce);
    kwDebounce = setTimeout(() => {
      if ($('inputAutoKeywords').value === 'true') {
        generateKeywordTags($('inputSearch').value);
      }
    }, 500);
  });

  // Toggle keyword generation
  $('inputAutoKeywords').addEventListener('change', () => {
    if ($('inputAutoKeywords').value === 'true' && $('inputSearch').value.length > 1) {
      generateKeywordTags($('inputSearch').value);
    } else {
      $('keywordTags').style.display = 'none';
    }
  });

  addLog('✨ CSI Job Hunter Pro v10.0 — جاهز', 'accent');
  addLog('🧠 يدعم: توليد كلمات + تعلم ذاتي + زيارة صفحات + تجنب Cloudflare', 'info');
  loadResults();
});
