import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getSiteConfig } from "./site-adapter.mjs";
import {
  calculateFieldAccuracy,
  calculateDuplicateMetrics,
  calculateTrustScore,
  generateAuditSamples,
  loadCrawlRecords,
} from "./validation-engine.mjs";
import { loadInsights } from "./insight-engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_SITES_DIR = path.resolve(__dirname, "..", "config", "sites");
const STATE_DIR = path.resolve(__dirname, "..", "state");
const RECORDS_DIR = path.join(STATE_DIR, "records");

const TRUST_CAP = 300;

function readJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return null; }
}

export function listConfiguredSites() {
  if (!fs.existsSync(CONFIG_SITES_DIR)) return [];
  return fs.readdirSync(CONFIG_SITES_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(/\.json$/, ""));
}

function fileMatchesHost(file, hostname) {
  const norm = file.replace(/\.json$/, "").replace(/_/g, ".");
  return norm.includes(hostname);
}

function recordFilesForHost(hostname) {
  if (!fs.existsSync(RECORDS_DIR)) return [];
  return fs.readdirSync(RECORDS_DIR).filter(f => f.endsWith(".json") && fileMatchesHost(f, hostname));
}

function loadRecordsForHost(hostname) {
  const files = recordFilesForHost(hostname)
    .map(f => {
      const id = f.replace(/\.json$/, "");
      const stat = fs.statSync(path.join(RECORDS_DIR, f));
      return { id, mtime: stat.mtimeMs, records: loadCrawlRecords(id) || [] };
    })
    .filter(x => x.records.length > 0)
    .sort((a, b) => b.mtime - a.mtime);
  const totalRecords = files.reduce((s, x) => s + x.records.length, 0);
  let trustRecords = [];
  for (const f of files) {
    if (trustRecords.length >= TRUST_CAP) break;
    trustRecords = trustRecords.concat(f.records).slice(0, TRUST_CAP);
  }
  return { files: files.length, totalRecords, trustRecords, freshness: files.length ? files[0].mtime : null };
}

function entryFromLedger(hostname, ledger) {
  const e = ledger[hostname];
  if (!e) return null;
  const s = e.stats || {};
  return {
    strategy: e.verifiedStrategy || "unknown",
    verifiedAt: e.verifiedAt || null,
    totalChecks: s.totalChecks || 0,
    successful: s.successful || 0,
    failed: s.failed || 0,
    successRate: typeof s.successRate === "number" ? Math.round(s.successRate * 100) : null,
    lastCheck: s.lastCheck || null,
    identity: e.identity || null,
  };
}

function configCoverage(cfg) {
  const sels = cfg.extraction?.selectors || {};
  const fields = {};
  for (const k of ["title", "description", "price", "phone", "email", "whatsapp", "location", "company", "breadcrumb", "date"]) {
    fields[k] = Array.isArray(sels[k]) && sels[k].length > 0;
  }
  const keys = Object.keys(fields);
  const present = keys.filter(k => fields[k]).length;
  return {
    fields,
    coveragePct: Math.round((present / keys.length) * 100),
    region: cfg.extraction?.phoneRegion || "GENERIC",
    currencies: cfg.extraction?.currencies || [],
    countryCodes: cfg.extraction?.countryCodes || [],
    adIdPattern: cfg.extraction?.adIdPattern || null,
  };
}

function latestReportForHost(reports, hostname) {
  const filtered = reports.filter(r => String(r.site || "").startsWith(hostname));
  if (!filtered.length) return null;
  return filtered.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))[0];
}

function insightsForHost(insights, hostname) {
  if (!insights || !Array.isArray(insights.insights)) return { count: 0, items: [] };
  const items = insights.insights.filter(i => (i.evidence || []).some(u => String(u).includes(hostname)));
  return {
    count: items.length,
    items: items.slice(0, 5).map(i => ({ id: i.id, title: i.title, severity: i.severity, type: i.type })),
  };
}

function maturityGrade(covPct, trustScore, freshness, qualityScore) {
  const configScore = covPct >= 90 ? 40 : covPct >= 70 ? 30 : covPct >= 50 ? 20 : 10;
  const trustComponent = Math.round((trustScore ?? 0) * 0.35);
  let freshnessScore = 0;
  if (freshness) {
    const ageDays = (Date.now() - freshness) / 86400000;
    freshnessScore = Math.max(0, Math.round(15 - ageDays / 2));
  }
  const qualityComponent = qualityScore === null ? 0 : Math.round((qualityScore / 100) * 10);
  const score = Math.min(100, configScore + trustComponent + freshnessScore + qualityComponent);
  const grade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 45 ? "C" : "D";
  const reason = [];
  if (covPct < 70) reason.push("تكوين السليكتورات ناقص");
  if (!freshness) reason.push("لا يوجد تشغيل محفوظ محلياً");
  if ((trustScore ?? 0) < 50) reason.push("درجة ثقة منخفضة");
  if (!reason.length) reason.push("جاهز للإنتاج");
  return { grade, score, reason };
}

export function buildSiteProfile(hostname) {
  const cfg = getSiteConfig("https://" + hostname + "/x");
  const entry = entryFromLedger(hostname, readJSON(path.join(STATE_DIR, "strategy_ledger.json")) || {});
  const cov = configCoverage(cfg);
  const run = loadRecordsForHost(hostname);
  const latest = latestReportForHost(readJSON(path.join(STATE_DIR, "reports.json")) || [], hostname);
  const insights = insightsForHost(loadInsights(), hostname);

  let verification = null;
  if (run.trustRecords.length) {
    const fa = calculateFieldAccuracy(run.trustRecords);
    verification = {
      recordsAnalysed: run.trustRecords.length,
      fieldAccuracy: fa,
      duplicates: calculateDuplicateMetrics(run.trustRecords),
      trustScore: calculateTrustScore(fa, calculateDuplicateMetrics(run.trustRecords), generateAuditSamples(run.trustRecords, 20)),
    };
  }

  const qualityScore = latest?.metrics?.dataQualityScore ?? null;
  const maturity = maturityGrade(cov.coveragePct, verification?.trustScore?.score ?? null, run.freshness, qualityScore);

  return {
    hostname,
    url: "https://" + hostname,
    identity: {
      language: cfg.language || "en",
      search: cfg.search || null,
      pagination: cfg.pagination || null,
      excludeUrlPatterns: cfg.excludeUrlPatterns || [],
    },
    entry,
    extraction: cov,
    liveRun: {
      files: run.files,
      totalRecords: run.totalRecords,
      freshness: run.freshness ? new Date(run.freshness).toISOString() : null,
      daysSinceLastRun: run.freshness ? Math.round((Date.now() - run.freshness) / 86400000) : null,
      latestReport: latest ? {
        generatedAt: latest.generatedAt,
        totalAds: latest.totalAds,
        fields: latest.fields,
        qualityScore,
        healthScore: latest.metrics?.siteHealthScore ?? null,
        issues: latest.issues || [],
        suggestions: latest.configSuggestions || [],
      } : null,
      verification,
    },
    insights: { count: insights.count, items: insights.items },
    maturity,
  };
}

export function buildAllSiteProfiles() {
  return listConfiguredSites().map(buildSiteProfile);
}