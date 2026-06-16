import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";

const REPORTS_DIR = resolve("web/reports");

mkdirSync(REPORTS_DIR, { recursive: true });

const REQUIRED_FIELDS = ["title", "description", "price", "location", "phones", "emails"];

function hostnameFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "unknown"; }
}

export function generateAnalysisReport(ads, jobConfig, jobStats = {}) {
  const hostname = hostnameFromUrl(jobConfig.baseUrl || "");
  const timestamp = new Date().toISOString();
  const total = ads.length;

  const fieldStats = {};
  for (const field of REQUIRED_FIELDS) {
    const present = ads.filter(a => a[field] && a[field].toString().trim().length > 0).length;
    const empty = total - present;
    fieldStats[field] = {
      present, empty,
      pct: total > 0 ? Math.round((present / total) * 100) : 0,
    };
  }

  const withDesc = ads.filter(a => (a.description?.length || 0) > 30).length;
  const withPrice = ads.filter(a => a.price && a.price.toString().trim().length > 0).length;
  const withPhone = ads.filter(a => a.phones && a.phones.toString().trim().length > 0).length;
  const withEmail = ads.filter(a => a.emails && a.emails.toString().trim().length > 0).length;
  const withLocation = ads.filter(a => a.location && a.location.toString().trim().length > 0).length;
  const withTitle = ads.filter(a => a.title && a.title.toString().trim().length > 0).length;

  const blockedPages = jobStats.bansDetected || 0;
  const cloudflareDetections = jobStats.cloudflareDetections || 0;
  const retries = jobStats.retries || 0;
  const extractSuccess = jobStats.adsScraped || total;
  const extractAttempted = jobStats.linksAttempted || total;

  let selectorIssues = [];
  if (withTitle < total * 0.8) selectorIssues.push("title: coverage below 80%");
  if (withPrice < total * 0.5) selectorIssues.push("price: coverage below 50%");
  if (withDesc < total * 0.5) selectorIssues.push("description: coverage below 50%");
  if (withLocation < total * 0.5) selectorIssues.push("location: coverage below 50%");
  if (withPhone < total * 0.3) selectorIssues.push("phone: coverage below 30%");

  const dqScore = total > 0
    ? Math.round((withTitle + withPrice + withDesc + withLocation + withPhone + withEmail) / (total * 6) * 100)
    : 0;

  const healthScore = total > 0
    ? Math.round((dqScore * 0.5) + (extractSuccess / Math.max(extractAttempted, 1)) * 30 + Math.max(0, 20 - blockedPages * 2))
    : 0;

  const suggestedConfigs = [];
  if (withPrice < total * 0.3) {
    suggestedConfigs.push("Add more price selectors to extraction.selectors.price in site config");
  }
  if (withDesc < total * 0.3) {
    suggestedConfigs.push("Add more description selectors or check page structure for content class changes");
  }
  if (withPhone < total * 0.2) {
    suggestedConfigs.push("Phone regex may need adjustment for this site's format");
  }
  if (blockedPages > total * 0.3) {
    suggestedConfigs.push("High block rate — increase pageDelay or reduce concurrency in site config");
  }

  const report = {
    reportId: `${hostname}_${timestamp.slice(0, 10)}_${Date.now()}`,
    generatedAt: timestamp,
    site: hostname,
    siteUrl: jobConfig.baseUrl || "",
    totalAds: total,
    duration: jobStats.duration || 0,
    fields: fieldStats,
    metrics: {
      dataQualityScore: dqScore,
      siteHealthScore: Math.min(100, healthScore),
      withTitle: `${withTitle}/${total}`,
      withPrice: `${withPrice}/${total}`,
      withDescription: `${withDesc}/${total}`,
      withLocation: `${withLocation}/${total}`,
      withPhone: `${withPhone}/${total}`,
      withEmail: `${withEmail}/${total}`,
      blockedPages,
      cloudflareDetections,
      retries,
      extractionRate: extractAttempted > 0 ? Math.round((extractSuccess / extractAttempted) * 100) : 0,
    },
    issues: selectorIssues,
    configSuggestions: suggestedConfigs,
    rawStats: jobStats,
  };

  return report;
}

export function saveAnalysisReport(report) {
  const filename = `${report.reportId}.json`;
  const filepath = resolve(REPORTS_DIR, filename);
  writeFileSync(filepath, JSON.stringify(report, null, 2), "utf8");
  return filepath;
}

export function loadLatestReport(hostname) {
  if (!existsSync(REPORTS_DIR)) return null;
  const files = readdirSync(REPORTS_DIR)
    .filter(f => f.startsWith(hostname + "_") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync(resolve(REPORTS_DIR, files[0]), "utf8"));
  } catch { return null; }
}

export function loadAllReports() {
  if (!existsSync(REPORTS_DIR)) return [];
  const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith(".json")).sort().reverse();
  return files.map(f => {
    try { return JSON.parse(readFileSync(resolve(REPORTS_DIR, f), "utf8")); } catch { return null; }
  }).filter(Boolean);
}

export function computeSiteHealthScores() {
  const reports = loadAllReports();
  const scores = {};
  for (const r of reports) {
    const site = r.site;
    if (!scores[site] || new Date(r.generatedAt) > new Date(scores[site].generatedAt)) {
      scores[site] = {
        site,
        lastCrawl: r.generatedAt,
        healthScore: r.metrics.siteHealthScore,
        dataQualityScore: r.metrics.dataQualityScore,
        totalAds: r.totalAds,
        issues: r.issues.length,
      };
    }
  }
  return Object.values(scores).sort((a, b) => b.healthScore - a.healthScore);
}
