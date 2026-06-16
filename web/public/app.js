let currentJobId = null;
let siteConfigs = {};

document.addEventListener("DOMContentLoaded", () => {
  loadSites();
  loadHealthScores();

  const siteSelect = document.getElementById("siteSelect");
  if (siteSelect) {
    siteSelect.addEventListener("change", () => {
      const opt = siteSelect.selectedOptions[0];
      if (opt && opt.dataset.url) {
        document.getElementById("urlInput").value = opt.dataset.url;
      }
    });
  }

  const launchBtn = document.getElementById("launchBtn");
  if (launchBtn) {
    launchBtn.addEventListener("click", launchCrawl);
  }

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      const panel = document.getElementById("tab-" + tab.dataset.tab);
      if (panel) panel.classList.add("active");
      if (tab.dataset.tab === "health") loadHealthScores();
      if (tab.dataset.tab === "reports") loadReports();
    });
  });
});

async function loadSites() {
  const sel = document.getElementById("siteSelect");
  if (!sel) return;
  try {
    const r = await fetch("/api/sites");
    const sites = await r.json();
    sel.innerHTML = '<option value="">Select a site...</option>';
    siteConfigs = {};
    for (const s of sites) {
      const opt = document.createElement("option");
      opt.value = s.hostname;
      opt.textContent = s.name;
      opt.dataset.url = `https://www.${s.hostname}`;
      opt.dataset.selectors = (s.extractionSelectors || []).join(", ");
      if (s.language === "ar") opt.textContent += " (عربي)";
      sel.appendChild(opt);
      siteConfigs[s.hostname] = s;
    }
    if (sites.length > 0) {
      sel.value = sites[0].hostname;
      sel.dispatchEvent(new Event("change"));
    }
  } catch {
    sel.innerHTML = '<option value="">Failed to load sites</option>';
  }
}

async function launchCrawl() {
  const siteSelect = document.getElementById("siteSelect");
  const url = document.getElementById("urlInput").value.trim();
  const search = document.getElementById("searchInput").value.trim();
  const maxAds = parseInt(document.getElementById("maxAdsInput").value) || 20;
  const concurrency = parseInt(document.getElementById("concurrencyInput").value) || 3;
  const delay = parseInt(document.getElementById("delayInput").value) || 1500;

  if (!url) { alert("Enter a site URL"); return; }

  const btn = document.getElementById("launchBtn");
  btn.disabled = true;
  btn.textContent = "Launching...";

  try {
    const r = await fetch("/api/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, search, maxAds, concurrency, delay }),
    });
    const job = await r.json();
    currentJobId = job.jobId;
    showJobPanel(job.jobId);
    connectSSE(job.jobId);
  } catch (err) {
    log("err", "Failed to launch crawl: " + err.message);
  }
  btn.disabled = false;
  btn.textContent = "Launch Crawl";
}

function showJobPanel(jobId) {
  document.getElementById("welcomePanel").style.display = "none";
  const panel = document.getElementById("jobPanel");
  panel.style.display = "block";
  document.getElementById("jobTitle").textContent = "Crawl: " + jobId;
  document.getElementById("exportPanel").style.display = "none";
  document.getElementById("logPanel").innerHTML = "";
  document.getElementById("progressFill").style.width = "0%";
  document.getElementById("statProgress").textContent = "0%";
  document.getElementById("statScraped").textContent = "0";
  document.getElementById("statFailed").textContent = "0";
  document.getElementById("statLinks").textContent = "0";
}

function connectSSE(jobId) {
  const evtSource = new EventSource(`/api/crawl/${jobId}/stream`);

  evtSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSSEEvent(data);
    } catch {}
  };

  evtSource.onerror = () => {
    log("warn", "SSE connection lost, polling fallback...");
    evtSource.close();
    pollJob(jobId);
  };
}

function handleSSEEvent(data) {
  switch (data.type) {
    case "connected":
      log("info", "Connected to crawl stream");
      break;
    case "status":
      log("info", "Status: " + data.status);
      break;
    case "search":
      log("info", "Searching: " + data.keyword);
      break;
    case "linksFound":
      log("ok", `Found ${data.count} links for "${data.keyword}"`);
      break;
    case "discoveryComplete":
      document.getElementById("statLinks").textContent = data.totalLinks;
      log("ok", `Discovery complete: ${data.totalLinks} total links`);
      break;
    case "adScraped":
      log("ok", `[${data.index}/${data.total}] Scraped: ${data.url}`);
      break;
    case "adFailed":
      log("err", `[${data.index}/${data.total}] Failed: ${data.url}`);
      break;
    case "progress":
      document.getElementById("statProgress").textContent = data.progress + "%";
      document.getElementById("statScraped").textContent = data.scraped;
      document.getElementById("statFailed").textContent = data.failed;
      document.getElementById("progressFill").style.width = data.progress + "%";
      break;
    case "exportComplete":
      showExport(data.files, data.integrity);
      log("ok", "Export complete");
      break;
    case "analysisComplete":
      showReport(data.report);
      log("ok", `Analysis complete — DQ: ${data.report.metrics.dataQualityScore}%, Health: ${data.report.metrics.siteHealthScore}%`);
      break;
    case "completed":
      log("ok", "Crawl completed successfully");
      document.getElementById("jobTitle").textContent = "Crawl Completed ✓";
      break;
    case "failed":
      log("err", "Crawl failed: " + (data.error || "Unknown error"));
      document.getElementById("jobTitle").textContent = "Crawl Failed ✗";
      break;
  }
}

async function pollJob(jobId) {
  const interval = setInterval(async () => {
    try {
      const r = await fetch(`/api/crawl/${jobId}`);
      const job = await r.json();
      document.getElementById("statProgress").textContent = job.progress + "%";
      document.getElementById("statScraped").textContent = job.adsScraped;
      document.getElementById("statFailed").textContent = job.adsFailed;
      document.getElementById("statLinks").textContent = job.linksFound;
      document.getElementById("progressFill").style.width = job.progress + "%";
      if (job.status === "completed" || job.status === "failed") {
        clearInterval(interval);
        if (job.status === "completed") log("ok", "Crawl completed");
        else log("err", "Crawl failed: " + (job.error || ""));
      }
    } catch { clearInterval(interval); }
  }, 2000);
}

function showExport(files, integrity) {
  document.getElementById("exportPanel").style.display = "block";
  const container = document.getElementById("exportFiles");
  if (!files || Object.keys(files).length === 0) {
    container.innerHTML = '<div class="empty">No export files generated</div>';
  } else {
    let html = "<table><tr><th>Format</th><th>File</th></tr>";
    for (const [fmt, filepath] of Object.entries(files)) {
      const name = filepath.split(/[\\/]/).pop();
      html += `<tr><td>${fmt.toUpperCase()}</td><td>${name}</td></tr>`;
    }
    html += "</table>";
    container.innerHTML = html;
  }

  const integContainer = document.getElementById("integrityPanel");
  if (integrity) {
    let html = '<table><tr><th>Check</th><th>Status</th></tr>';
    for (const [key, val] of Object.entries(integrity)) {
      const ok = val === true || val === "ok" || val?.status === "ok";
      const label = typeof val === "object" ? val.status || JSON.stringify(val) : String(val);
      html += `<tr><td>${key}</td><td><span class="badge ${ok ? 'green' : 'red'}">${label}</span></td></tr>`;
    }
    html += "</table>";
    integContainer.innerHTML = html;
  } else {
    integContainer.innerHTML = '<div class="empty">No integrity data</div>';
  }
}

function showReport(report) {
  const panel = document.getElementById("reportPanel");
  if (!report) { panel.innerHTML = '<div class="empty">No report generated</div>'; return; }
  const m = report.metrics || {};
  const fields = report.fields || {};

  let html = `
    <div class="stat-grid" style="margin-bottom:12px">
      <div class="stat"><div class="value ${m.dataQualityScore >= 80 ? 'green' : m.dataQualityScore >= 50 ? 'yellow' : 'red'}">${m.dataQualityScore}</div><div class="label">Data Quality</div></div>
      <div class="stat"><div class="value ${m.siteHealthScore >= 80 ? 'green' : m.siteHealthScore >= 50 ? 'yellow' : 'red'}">${m.siteHealthScore}</div><div class="label">Site Health</div></div>
      <div class="stat"><div class="value green">${m.withTitle || '?'}</div><div class="label">Title</div></div>
      <div class="stat"><div class="value green">${m.withPrice || '?'}</div><div class="label">Price</div></div>
      <div class="stat"><div class="value green">${m.withDescription || '?'}</div><div class="label">Description</div></div>
      <div class="stat"><div class="value green">${m.withLocation || '?'}</div><div class="label">Location</div></div>
      <div class="stat"><div class="value green">${m.withPhone || '?'}</div><div class="label">Phone</div></div>
      <div class="stat"><div class="value green">${m.withEmail || '?'}</div><div class="label">Email</div></div>
    </div>
    <h3>Field Coverage</h3>`;

  for (const [field, f] of Object.entries(fields)) {
    const pct = f.pct || 0;
    const color = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)';
    html += `<div class="field-bar"><span class="label">${field}</span><div class="bar" style="background:${color};width:${pct}%"></div><span class="pct">${pct}%</span></div>`;
  }

  if (report.issues && report.issues.length > 0) {
    html += '<h3 style="margin-top:12px">Issues</h3><ul style="color:var(--yellow);font-size:13px;padding-left:16px">';
    for (const issue of report.issues) html += `<li>${issue}</li>`;
    html += "</ul>";
  }

  if (report.configSuggestions && report.configSuggestions.length > 0) {
    html += '<h3 style="margin-top:12px">Suggested Improvements</h3><ul style="color:var(--accent);font-size:13px;padding-left:16px">';
    for (const s of report.configSuggestions) html += `<li>${s}</li>`;
    html += "</ul>";
  }

  panel.innerHTML = html;
}

async function loadHealthScores() {
  const container = document.getElementById("healthScores") || document.getElementById("healthPanel");
  if (!container) return;
  try {
    const r = await fetch("/api/health");
    const scores = await r.json();
    if (scores.length === 0) {
      container.innerHTML = '<div class="empty">No crawl data yet. Run a crawl to generate health scores.</div>';
      return;
    }
    let html = "";
    for (const s of scores) {
      const color = s.healthScore >= 80 ? 'green' : s.healthScore >= 50 ? 'yellow' : 'red';
      html += `<div class="health-card">
        <div class="score ${color}">${s.healthScore}</div>
        <div class="info">
          <div class="name">${s.site}</div>
          <div class="meta">DQ: ${s.dataQualityScore}% · ${s.totalAds} ads · ${s.issues} issues · ${new Date(s.lastCrawl).toLocaleDateString()}</div>
        </div>
      </div>`;
    }
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<div class="empty">Failed to load health scores</div>';
  }
}

async function loadReports() {
  const container = document.getElementById("reportsList");
  if (!container) return;
  try {
    const r = await fetch("/api/reports");
    const reports = await r.json();
    if (reports.length === 0) {
      container.innerHTML = '<div class="empty">No analysis reports yet. Run a crawl to generate one.</div>';
      return;
    }
    let html = '<table><tr><th>Site</th><th>Date</th><th>Ads</th><th>DQ Score</th><th>Health</th><th>Issues</th></tr>';
    for (const rep of reports) {
      const m = rep.metrics || {};
      html += `<tr>
        <td>${rep.site}</td>
        <td>${new Date(rep.generatedAt).toLocaleDateString()}</td>
        <td>${rep.totalAds}</td>
        <td><span class="badge ${m.dataQualityScore >= 80 ? 'green' : m.dataQualityScore >= 50 ? 'yellow' : 'red'}">${m.dataQualityScore}%</span></td>
        <td><span class="badge ${m.siteHealthScore >= 80 ? 'green' : m.siteHealthScore >= 50 ? 'yellow' : 'red'}">${m.siteHealthScore}%</span></td>
        <td>${rep.issues?.length || 0}</td>
      </tr>`;
    }
    html += '</table>';
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<div class="empty">Failed to load reports</div>';
  }
}

function log(type, msg) {
  const panel = document.getElementById("logPanel");
  if (!panel) return;
  const line = document.createElement("div");
  line.className = "line " + type;
  const ts = new Date().toLocaleTimeString();
  line.textContent = `[${ts}] ${msg}`;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
}
