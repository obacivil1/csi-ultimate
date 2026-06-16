/**
 * ============================================================
 *  CSI-Ultimate — Crawler Core v2
 *  core/crawler-core.mjs
 * ============================================================
 */

import { WorkerQueue }       from "./queue.mjs";
import { adCache, pageCache } from "./cache.mjs";
import { dedupe }             from "./dedupe.mjs";
import { rateLimiter }       from "./rate-limiter.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { SemanticPageClassifier } from "./semantic-page-classifier.mjs";
import { PageDecisionEngine } from "./page-decision-engine.mjs";
import { PatternRegistry } from "./pattern-registry.mjs";
import { DiscoveryHypothesisEngine } from "./adaptive-discovery-engine.mjs";
import { ExplorationStrategy } from "./exploration-strategy.mjs";
import { HypothesisValidator } from "./hypothesis-validator.mjs";
import { AdaptiveLearningLoop } from "./adaptive-learning-loop.mjs";
import { OpportunityScorer } from "./opportunity-scorer.mjs";
import { UniversalKnowledgeEngine } from "./universal-knowledge-engine.mjs";
import { KnowledgeTransferEngine } from "./knowledge-transfer-engine.mjs";
import { CrossSiteReasoner } from "./cross-site-reasoner.mjs";
import { getSiteConfig, getAdIdPattern } from "./site-adapter.mjs";

const delay = ms => new Promise(r => setTimeout(r, ms));
const semanticPageClassifier = new SemanticPageClassifier();
const pageDecisionEngine = new PageDecisionEngine();
const patternRegistry = new PatternRegistry();
const discoveryHypothesisEngine = new DiscoveryHypothesisEngine();
const explorationStrategy = new ExplorationStrategy();
const hypothesisValidator = new HypothesisValidator();
const adaptiveLearningLoop = new AdaptiveLearningLoop();
const opportunityScorer = new OpportunityScorer();
const universalKnowledgeEngine = new UniversalKnowledgeEngine();
const knowledgeTransferEngine = new KnowledgeTransferEngine({ knowledgeEngine: universalKnowledgeEngine });
const crossSiteReasoner = new CrossSiteReasoner({ knowledgeEngine: universalKnowledgeEngine, transferEngine: knowledgeTransferEngine });

function getCrawlPriority(pageType) {
  switch (pageType) {
    case "JOB_AD_PAGE":
    case "REAL_ESTATE_AD_PAGE":
    case "VEHICLE_AD_PAGE":
      return 100;
    case "JOB_LISTING_PAGE":
    case "REAL_ESTATE_LISTING_PAGE":
    case "VEHICLE_LISTING_PAGE":
      return 70;
    case "DIRECTORY_PAGE":
      return 60;
    case "CATEGORY_PAGE":
      return 50;
    case "BLOG_ARTICLE_PAGE":
      return 20;
    case "UNKNOWN_PAGE":
    default:
      return 5;
  }
}

function summarizeClassification(result) {
  if (!result) return null;
  return {
    url: result.url,
    pageType: result.pageType,
    confidence: result.confidence,
    scores: result.scores,
    matchedKeywords: result.matchedKeywords,
  };
}

export function buildPageMetadata(url, classification, context = {}) {
  return {
    url,
    pageType: classification?.pageType || "UNKNOWN_PAGE",
    confidence: Number(classification?.confidence || 0),
    scores: classification?.scores || [],
    matchedKeywords: classification?.matchedKeywords || [],
    crawlPriority: getCrawlPriority(classification?.pageType || "UNKNOWN_PAGE"),
    ...context,
  };
}

export function getSemanticClassificationStats(pageMetadataEntries = []) {
  const pagesByType = {};
  let totalConfidence = 0;
  const keywordCounts = new Map();

  for (const entry of pageMetadataEntries) {
    pagesByType[entry.pageType] = (pagesByType[entry.pageType] || 0) + 1;
    totalConfidence += Number(entry.confidence || 0);
    for (const keyword of entry.matchedKeywords || []) {
      keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
    }
  }

  const topMatchedKeywords = [...keywordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([keyword, count]) => ({ keyword, count }));

  return {
    pagesByType,
    averageConfidence: pageMetadataEntries.length
      ? Number((totalConfidence / pageMetadataEntries.length).toFixed(3))
      : 0,
    topMatchedKeywords,
  };
}

export function summarizePageState(state) {
  if (!state) return "unknown";
  const title = state.title ? `title=${JSON.stringify(state.title.slice(0, 80))}` : "title=\"\"";
  return `${state.kind} (bodyLen=${state.bodyLen}, links=${state.linkCount}, h1=${state.hasH1 ? 1 : 0}, ${title})`;
}

function slugify(value) {
  return String(value || "page")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "page";
}

export async function captureDiscoveryEvidence(page, requestedUrl, opts = {}) {
  const outputDir = resolve(opts.outputDir ?? "./output/debug-discovery");
  const debugEnabled = !!opts.debugDiscovery;
  const zeroLinks = !!opts.zeroLinks;

  const pageState = await classifyPageState(page);
  const finalUrl = typeof page.url === "function" ? page.url() : requestedUrl;
  const title = await page.title().catch(() => "");
  const html = await (typeof page.content === "function"
    ? page.content()
    : page.evaluate(() => document.documentElement?.outerHTML || ""))
    .then(result => {
      if (typeof result === "string") return result;
      if (result && typeof result === "object") {
        if (typeof result.outerHTML === "string") return result.outerHTML;
        if (typeof result.html === "string") return result.html;
      }
      return "";
    })
    .catch(() => "");
  const htmlSnippet = String(html || "").slice(0, 3000);
  const redirectDetected = finalUrl !== requestedUrl;
  const evidence = {
    requestedUrl,
    finalUrl,
    title,
    redirectDetected,
    classification: pageState.kind,
    isChallenge: !!pageState.isChallenge,
    contentLength: pageState.bodyLen,
    linkCount: pageState.linkCount,
    matchedLinkCount: opts.matchedLinkCount ?? 0,
    hasH1: !!pageState.hasH1,
    capturedAt: new Date().toISOString(),
  };

  const shouldPersist = debugEnabled || pageState.kind === "cloudflare" || pageState.kind === "empty" || zeroLinks;
  if (shouldPersist) {
    const hostSlug = slugify(new URL(requestedUrl).hostname || "page");
    const stamp = `${Date.now()}-${hostSlug}`;
    const targetDir = resolve(outputDir, stamp);
    mkdirSync(targetDir, { recursive: true });

    writeFileSync(resolve(targetDir, "classification.json"), JSON.stringify(evidence, null, 2));
    writeFileSync(resolve(targetDir, "snapshot.html"), htmlSnippet);

    if (debugEnabled || pageState.kind === "cloudflare" || pageState.kind === "empty") {
      try {
        if (typeof page.screenshot === "function") {
          await page.screenshot({ path: resolve(targetDir, "screenshot.png"), fullPage: true });
        }
      } catch {}
    }

    const reportPath = resolve(outputDir, "discovery-report.json");
    let report = [];
    if (existsSync(reportPath)) {
      try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch {}
    }
    report.push({ ...evidence, snapshotPath: resolve(targetDir, "snapshot.html"), screenshotPath: resolve(targetDir, "screenshot.png") });
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  console.log(`🔎 discovery: title=${JSON.stringify(title || "")} finalUrl=${JSON.stringify(finalUrl)} classification=${pageState.kind} contentLen=${pageState.bodyLen} links=${pageState.linkCount} matchedLinks=${opts.matchedLinkCount ?? 0} redirect=${redirectDetected ? 1 : 0}`);
  return evidence;
}

// ============================================================
//  waitForCloudflare — ينتظر حتى تنتهي صفحة CF
// ============================================================

async function waitForCloudflare(page, maxWait = 20000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const title = await page.title().catch(() => "");
    const body  = await page.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0);
    if (
      !title.includes("Just a moment") &&
      !title.includes("Attention Required") &&
      !title.includes("Checking your browser") &&
      body > 200
    ) return true;
    await page.waitForTimeout(1500);
  }
  return false;
}

// ============================================================
//  smartLoad — يحاول تحميل الصفحة بعدة استراتيجيات
// ============================================================

export async function smartLoad(page, url, opts = {}) {
  await rateLimiter.wait();

  const applySemanticMetadata = async (source = "smart-load") => {
    try {
      const metadata = await classifyPageSemantically(page, url, { source });
      page.__semanticMetadata = metadata;
      return metadata;
    } catch {
      const fallback = buildPageMetadata(url, { pageType: "UNKNOWN_PAGE", confidence: 0, scores: [], matchedKeywords: [] }, { source });
      page.__semanticMetadata = fallback;
      return fallback;
    }
  };

  const attemptLoad = async (waitUntil, timeout, extraDelay) => {
    await page.goto(url, { waitUntil, timeout });
    if (extraDelay > 0) await page.waitForTimeout(extraDelay);
    const passed = await waitForCloudflare(page, 20000);
    return passed;
  };

  // المحاولة 1: domcontentloaded مع انتظار CF
  try {
    const passed = await attemptLoad("domcontentloaded", 20000, 2000);
    if (passed) {
      rateLimiter.onSuccess();
      await applySemanticMetadata(opts.source || "smart-load");
      await captureDiscoveryEvidence(page, url, { ...opts, zeroLinks: false });
      return true;
    }
  } catch {}

  // المحاولة 2: load مع انتظار أطول
  try {
    const passed = await attemptLoad("load", 25000, 3000);
    if (passed) {
      rateLimiter.onSuccess();
      await applySemanticMetadata(opts.source || "smart-load");
      await captureDiscoveryEvidence(page, url, { ...opts, zeroLinks: false });
      return true;
    }
  } catch {}

  // المحاولة 3: commit فقط
  try {
    const passed = await attemptLoad("commit", 15000, 5000);
    if (passed) {
      rateLimiter.onSuccess();
      await applySemanticMetadata(opts.source || "smart-load");
      await captureDiscoveryEvidence(page, url, { ...opts, zeroLinks: false });
      return true;
    }
  } catch {}

  const state = await classifyPageState(page).catch(() => ({ kind: "unknown" }));
  rateLimiter.onError(false);
  await applySemanticMetadata(opts.source || "smart-load");
  await captureDiscoveryEvidence(page, url, { ...opts, zeroLinks: false });
  console.warn(`  ⚠️ smartLoad failed for ${url} -> ${summarizePageState(state)}`);
  return false;
}

export async function classifyPageSemantically(page, url, opts = {}) {
  try {
    const html = await page.content().catch(() => "");
    const classification = semanticPageClassifier.classifyPage(html);
    const metadata = buildPageMetadata(url, classification, {
      source: opts.source || "page",
      title: await page.title().catch(() => ""),
    });
    page.__semanticMetadata = metadata;
    console.log(`[CLASSIFIER] URL: ${url}`);
    console.log(`[CLASSIFIER] PAGE_TYPE: ${metadata.pageType}`);
    console.log(`[CLASSIFIER] CONFIDENCE: ${metadata.confidence.toFixed(3)}`);
    return metadata;
  } catch (error) {
    const fallback = buildPageMetadata(url, { pageType: 'UNKNOWN_PAGE', confidence: 0, scores: [], matchedKeywords: [] });
    page.__semanticMetadata = fallback;
    console.log(`[CLASSIFIER] URL: ${url}`);
    console.log(`[CLASSIFIER] PAGE_TYPE: ${fallback.pageType}`);
    console.log(`[CLASSIFIER] CONFIDENCE: ${fallback.confidence.toFixed(3)}`);
    return fallback;
  }
}

export function decidePageAction(url, metadata = {}, discoveredLinks = []) {
  const decision = pageDecisionEngine.decide({
    url,
    pageType: metadata.pageType,
    confidence: metadata.confidence,
    semanticScores: metadata.scores || [],
    discoveredLinks,
  });

  const fingerprint = buildFingerprint(url, metadata, discoveredLinks);
  const opportunity = opportunityScorer.score({
    semanticSignals: metadata.scores?.map(score => score.keyword || score.type || '') || [],
    linkCount: discoveredLinks.length,
    repeatedBlocks: discoveredLinks.length > 8 ? 2 : 1,
    patternSimilarity: 0.2,
    explorationSuccessRate: adaptiveLearningLoop.getStats().successRate,
    historicalSuccess: adaptiveLearningLoop.getStats().successfulHypotheses / Math.max(1, adaptiveLearningLoop.getStats().successfulHypotheses + adaptiveLearningLoop.getStats().failedHypotheses),
  });
  const match = patternRegistry.findSimilarPatterns(fingerprint, { threshold: 0.45 })[0];
  if (match) {
    decision.reasoning = `${decision.reasoning} | pattern-reuse:${match.patternType}@${match.score}`;
    decision.patternMatch = match;
    console.log(`[PATTERN_MATCH] URL: ${url} | PATTERN_ID: ${match.patternId} | SCORE: ${match.score}`);
    console.log(`[PATTERN_REUSED] URL: ${url} | PATTERN_ID: ${match.patternId}`);
  }

  const adaptiveHypotheses = discoveryHypothesisEngine.generateHypotheses({
    pageType: metadata.pageType,
    confidence: metadata.confidence,
    semanticSignals: metadata.scores?.map(score => score.keyword || score.type || '') || [],
    linkCount: discoveredLinks.length,
    contentDensity: 0.6,
    repeatedBlocks: discoveredLinks.length > 8 ? 2 : 1,
    commercialIndicators: discoveredLinks.map(link => link.text || '').filter(Boolean),
  });
  const exploredActions = explorationStrategy.rankActions({
    pageType: metadata.pageType,
    confidence: metadata.confidence,
    linkCount: discoveredLinks.length,
    commercialIndicators: discoveredLinks.map(link => link.text || '').filter(Boolean),
    repeatedBlocks: discoveredLinks.length > 8 ? 2 : 1,
  });
  const learned = patternRegistry.learnPattern({
    patternType: decidePatternType(metadata.pageType),
    fingerprint,
    pageType: metadata.pageType,
    url,
    confidence: metadata.confidence || 0.5,
  });
  if (learned) {
    console.log(`[PATTERN_LEARNED] URL: ${url} | PATTERN_ID: ${learned.patternId} | TYPE: ${learned.patternType}`);
  }

  const universalSignals = {
    semanticSignals: metadata.scores?.map(score => score.keyword || score.type || '') || [],
    structuralSignals: discoveredLinks.length > 8 ? ['many-similar-links'] : [],
    linkTopology: { linkDensity: discoveredLinks.length > 0 ? Math.min(0.95, discoveredLinks.length / 12) : 0.1, repeatedBlocks: discoveredLinks.length > 8 ? 2 : 1 },
    domFingerprint: metadata.pageType || 'unknown',
  };
  const universalReasoning = crossSiteReasoner.reason(universalSignals);
  const universalConcept = universalKnowledgeEngine.abstractPageToConcept(universalSignals);
  universalKnowledgeEngine.learnFromObservation({
    pageType: metadata.pageType,
    semanticSignals: universalSignals.semanticSignals,
    structuralSignals: universalSignals.structuralSignals,
    linkTopology: universalSignals.linkTopology,
    domFingerprint: universalSignals.domFingerprint,
  });

  decision.adaptiveHypotheses = adaptiveHypotheses;
  decision.explorationActions = exploredActions;
  decision.opportunity = opportunity;
  decision.universalKnowledge = {
    conceptName: universalConcept.conceptName,
    confidence: universalConcept.confidence,
    action: universalReasoning.action,
    reasoning: universalReasoning.reasoning,
    transfer: universalReasoning.transfer,
  };
  decision.validation = hypothesisValidator.validate({
    hypothesisType: adaptiveHypotheses[0]?.hypothesisType || 'POSSIBLE_UNKNOWN_PAGE',
    predictedOutcome: adaptiveHypotheses[0]?.hypothesisType || 'unknown',
    observedOutcome: discoveredLinks.length > 0 ? 'discovered links' : 'no links',
  });

  console.log(`[DECISION] URL: ${url}`);
  console.log(`[DECISION] ACTION: ${decision.action}`);
  console.log(`[DECISION] PRIORITY: ${decision.priority}`);
  console.log(`[DECISION] REASON: ${decision.reasoning}`);
  console.log(`[ADAPTIVE_HYPOTHESIS_CREATED] URL: ${url} | HYPOTHESIS: ${adaptiveHypotheses[0]?.hypothesisType || 'POSSIBLE_UNKNOWN_PAGE'} | CONFIDENCE: ${adaptiveHypotheses[0]?.confidence || 0}`);
  console.log(`[OPPORTUNITY_DISCOVERED] URL: ${url} | LEVEL: ${opportunity.opportunityLevel} | SCORE: ${opportunity.score}`);

  return decision;
}

function decidePatternType(pageType = 'UNKNOWN_PAGE') {
  if (/AD_PAGE/.test(pageType)) return 'ad';
  if (/LISTING_PAGE/.test(pageType)) return 'listing';
  if (pageType === 'DIRECTORY_PAGE') return 'directory';
  if (pageType === 'CATEGORY_PAGE') return 'category';
  if (pageType === 'BLOG_ARTICLE_PAGE') return 'blog';
  return 'unknown';
}

function buildFingerprint(url, metadata = {}, discoveredLinks = []) {
  const pageType = metadata.pageType || 'UNKNOWN_PAGE';
  const path = new URL(url, 'https://example.com').pathname.toLowerCase();
  const segments = path.split('/').filter(Boolean);
  const urlPattern = segments.length ? `/${segments.slice(0, Math.min(segments.length, 3)).join('/')}/` : '/';
  const linkTexts = discoveredLinks.map(link => link.text || link.url || '').filter(Boolean);
  const domShape = ['article', 'h2', 'a'];
  const headingHierarchy = ['h1', 'h2'];
  const repeatedSelectors = ['article', 'a'];
  const semanticSignals = [pageType, ...(metadata.scores || []).slice(0, 3).map(score => score.keyword || score.type || '')].filter(Boolean);

  return {
    urlPattern,
    domShape,
    headingHierarchy,
    repeatedSelectors,
    semanticSignals,
    internalLinkStructure: linkTexts.length ? linkTexts.slice(0, 4) : ['home'],
  };
}

export function buildQueueScore(url, metadata = {}, discoveredLinks = []) {
  const decision = decidePageAction(url, metadata, discoveredLinks);
  return {
    url,
    score: decision.priority + Math.max(0, ...decision.linkScores.map(link => link.score)),
    sourcePageType: metadata.pageType || 'UNKNOWN_PAGE',
    action: decision.action,
    priority: decision.priority,
  };
}

export function getDecisionStats(decisions = []) {
  const pagesByType = {};
  const actionsExecuted = {};
  let totalConfidence = 0;

  for (const decision of decisions) {
    pagesByType[decision.pageType] = (pagesByType[decision.pageType] || 0) + 1;
    actionsExecuted[decision.action] = (actionsExecuted[decision.action] || 0) + 1;
    totalConfidence += Number(decision.confidence || 0);
  }

  return {
    pagesVisited: decisions.length,
    pagesByType,
    actionsExecuted,
    topPageTypes: Object.entries(pagesByType).sort((a, b) => b[1] - a[1]).slice(0, 5),
    averageConfidence: decisions.length ? Number((totalConfidence / decisions.length).toFixed(3)) : 0,
    decisionDistribution: actionsExecuted,
  };
}

// ============================================================
//  hasRealContent
// ============================================================

function normalizeUrl(rawUrl, baseUrl = "") {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl, baseUrl || undefined);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function getLinkSignals(link, baseUrl = "") {
  const normalized = normalizeUrl(link?.href || "", baseUrl);
  const u = normalized ? new URL(normalized) : null;
  const path = u ? `${u.pathname}${u.search}`.toLowerCase() : "";
  const text = String(link?.text || "").trim().toLowerCase();
  const host = u?.hostname?.toLowerCase() || "";
  const isSameHost = !!u && !!baseUrl && host === new URL(baseUrl).hostname.toLowerCase();
  const isRootLike = !u || u.pathname === "/" || u.pathname === "";
  const isFileLike = /\.(pdf|zip|doc|docx|xls|xlsx|png|jpg|jpeg|gif|svg|webp|mp4|mp3)$/i.test(u?.pathname || "");
  const hasMeaningfulText = text.length >= 2 && !/^(home|about|contact|login|sign in|register|help|faq|privacy|terms|account|profile|logout|search|menu|nav)$/i.test(text);
  const hasCategoryWords = /category|categories|browse|directory|listings?|classifieds?|jobs|cars|property|rent|buy|sell|for-sale|forrent|forsale|real-estate|services?/i.test(path + " " + text);
  const hasNavigationWords = /login|register|sign.?in|sign.?up|account|profile|password|help|faq|contact|about|privacy|terms|cookie|sitemap|logout|home|menu|nav|service|services/i.test(path + " " + text);
  const hasListingPath = /(\/ad\/|\/cls\/|\/details?\/|\/view\/|\/listing|\/listings|\/classified|\/classifieds|\/jobs|\/cars|\/property|\/real-estate|\/rent|\/buy|\/sell|\/for-sale|\/forrent|\/forsale|\/services?)/i.test(path);
  const linkDensity = link?.linkDensity ?? 0;
  const isInSidebar = !!link?.inSidebar;
  const hasSectionContext = !!link?.sectionText;
  return { normalized, u, path, text, host, isSameHost, isRootLike, isFileLike, hasMeaningfulText, hasCategoryWords, hasNavigationWords, linkDensity, isInSidebar, hasSectionContext };
}

export function classifyDiscoveryLink(link, baseUrl = "", context = {}) {
  const signals = getLinkSignals({ ...link, ...context }, baseUrl);
  const { normalized, path, text, hasMeaningfulText, hasCategoryWords, hasNavigationWords, isRootLike, isFileLike, linkDensity, isInSidebar, hasSectionContext } = signals;
  const hasListingPath = /(\/ad\/|\/cls\/|\/details?\/|\/view\/|\/listing|\/listings|\/classified|\/classifieds|\/jobs|\/cars|\/property|\/real-estate|\/rent|\/buy|\/sell|\/for-sale|\/forrent|\/forsale|\/services?)/i.test(path);

  if (!normalized) return "unknown";
  if (isFileLike) return "navigation";
  if (/search|find|query/i.test(path) || /\bsearch\b/i.test(text)) return "search";
  if (/page|p=/i.test(path) || /[?&](page|p|pg)=\d+/i.test(path)) return "pagination";
  if (/\/ad\//i.test(path) || /\/cls\//i.test(path) || /\/details?\//i.test(path) || /\/view\//i.test(path) || /\/jobs?\//i.test(path) || /\/item\//i.test(path) || /\/post\//i.test(path) || /\/listing\//i.test(path) || /\/p\//i.test(path) || /[?&](id|ad|post)=/i.test(path)) return "detail";
  if (isRootLike && !hasMeaningfulText) return "navigation";
  if (hasNavigationWords && (!hasCategoryWords || linkDensity > 0.5)) return "navigation";
  if (hasListingPath && (hasMeaningfulText || isInSidebar || hasSectionContext || linkDensity <= 0.35)) return "category";
  if (hasCategoryWords && (hasMeaningfulText || isInSidebar || hasSectionContext || linkDensity <= 0.35)) return "category";
  if (hasMeaningfulText && (isInSidebar || hasSectionContext || linkDensity <= 0.25) && hasListingPath) return "category";
  return "unknown";
}

function inferLinkType(href, baseUrl = "", context = {}) {
  return classifyDiscoveryLink({ href, text: context.text || "" }, baseUrl, context);
}

function extractHtmlMatches(html, pattern, group = 1) {
  const matches = [];
  const re = new RegExp(pattern, "gi");
  let match;
  while ((match = re.exec(html)) !== null) matches.push(match[group] || match[0]);
  return matches;
}

export function discoverLinksFromHtml(html, baseUrl = "") {
  const anchors = extractHtmlMatches(html, /<a\b[^>]*href=(['"])(.*?)\1[^>]*>(.*?)<\/a>/gi, 2);
  return anchors.map(href => {
    const normalized = normalizeUrl(href, baseUrl);
    const text = extractHtmlMatches(html, new RegExp(`<a\\b[^>]*href=(['\\"])${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\1)[^>]*>(.*?)<\\/a>`, "i"), 2)[0] || "";
    return { href: normalized, text, type: inferLinkType(href, baseUrl, { text }) };
  }).filter(link => link.href);
}

export function learnLinkPatterns(urls) {
  const patterns = [];
  const seen = new Set();
  for (const raw of urls) {
    try {
      const url = new URL(raw);
      const path = url.pathname.replace(/\/+$/, "");
      const segments = path.split("/").filter(Boolean);
      if (!segments.length) continue;
      const pattern = segments.map(seg => /\d+/.test(seg) ? "*" : seg).join("/");
      if (!seen.has(pattern)) {
        seen.add(pattern);
        patterns.push(pattern);
      }
    } catch {}
  }
  return patterns;
}

export function selectCandidateLinks(links, baseUrl = "") {
  return [...links]
    .filter(link => normalizeUrl(link.href, baseUrl).startsWith(baseUrl || ""))
    .map(link => {
      const normalized = normalizeUrl(link.href, baseUrl);
      const type = link.type || inferLinkType(normalized, baseUrl, link);
      let score = 0;
      if (type === "detail") score += 5;
      if (type === "category") score += 3;
      if (type === "pagination") score += 2;
      if (type === "search") score += 1;
      if (type === "navigation") score -= 6;
      const path = new URL(normalized).pathname.toLowerCase();
      if (/ad|listing|item|post|classified|detail|view|cls|job|property|car|rent|sale/i.test(path)) score += 2;
      if (/\d+/.test(path)) score += 1;
      const segments = path.split('/').filter(Boolean);
      if (segments.some(s => /^\d{5,}$/.test(s))) score += 2;
      return { ...link, href: normalized, score, type };
    })
    .filter(link => link.type !== "navigation")
    .sort((a, b) => b.score - a.score)
    .map(l => l.href);
}

export function extractAdContentFromHtml(html, url = "") {
  const titleMatch = extractHtmlMatches(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i, 1)[0] ||
    extractHtmlMatches(html, /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i, 1)[0] ||
    extractHtmlMatches(html, /<h1[^>]*>(.*?)<\/h1>/i, 1)[0] ||
    extractHtmlMatches(html, /<title>(.*?)<\/title>/i, 1)[0] || "";
  const descriptionMatch = extractHtmlMatches(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i, 1)[0] ||
    extractHtmlMatches(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i, 1)[0] ||
    extractHtmlMatches(html, /<p[^>]*>(.*?)<\/p>/i, 1)[0] || "";
  const phones = extractHtmlMatches(html, /href=["']tel:([^"']+)["']/gi, 1);
  const emails = extractHtmlMatches(html, /href=["']mailto:([^"']+)["']/gi, 1);
  const ldJson = extractHtmlMatches(html, /<script[^>]+type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/is, 1)[0] || "";
  let parsedLd = null;
  try { parsedLd = JSON.parse(ldJson); } catch {}
  return {
    title: (parsedLd?.name || parsedLd?.headline || parsedLd?.title || titleMatch || "Untitled").trim(),
    description: (parsedLd?.description || descriptionMatch || "").trim(),
    phones: [...new Set([...phones, parsedLd?.telephone || "", parsedLd?.contactPoint?.telephone || ""].filter(Boolean))],
    emails: [...new Set([...emails, parsedLd?.email || "", parsedLd?.contactPoint?.email || ""].filter(Boolean))],
    url,
  };
}

export async function classifyPageState(page) {
  try {
    const state = await page.evaluate(() => {
      const title = (document.title || "").trim();
      const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      const bodyLen = bodyText.length;
      const linkCount = document.querySelectorAll("a[href]").length;
      const hasH1 = !!document.querySelector("h1");
      const hasMeaningfulText = bodyLen >= 20 || hasH1 || /\w{3,}/.test(title);
      const hasContent = hasMeaningfulText || linkCount > 0;

      const isCloudflare = /just a moment|attention required|checking your browser|enable javascript|cf-chl|error\s*1015/i.test(title) ||
        /enable javascript|cf-chl|just a moment|error\s*1015|ray\s*id:/i.test(bodyText) ||
        document.querySelector("#challenge-error-text") != null;

      if (isCloudflare) {
        return { kind: "cloudflare", isChallenge: true, bodyLen, linkCount, hasH1, title };
      }

      if (!hasContent) {
        return { kind: "empty", isChallenge: false, bodyLen, linkCount, hasH1, title };
      }

      return { kind: "content", isChallenge: false, bodyLen, linkCount, hasH1, title };
    });

    if (state && typeof state === "object" && ("kind" in state || "bodyLen" in state || "linkCount" in state)) {
      return {
        kind: state.kind || "content",
        isChallenge: !!state.isChallenge,
        bodyLen: Number(state.bodyLen || 0),
        linkCount: Number(state.linkCount || 0),
        hasH1: !!state.hasH1,
        title: String(state.title || ""),
      };
    }
  } catch {}

  return { kind: "content", isChallenge: false, bodyLen: 0, linkCount: 0, hasH1: false, title: "" };
}

export async function hasRealContent(page) {
  const state = await classifyPageState(page);
  return state.kind === "content";
}

// ============================================================
//  extractAd
// ============================================================

export async function extractAd(pool, url) {
  const cached = adCache.get(url);
  if (cached) return { ...cached, _fromCache: true };

  const siteConfig = getSiteConfig(url);
  const adIdPattern = getAdIdPattern(siteConfig);
  const extCfg = siteConfig.extraction;

  return await pool.withPage(async (page) => {
    const loaded = await smartLoad(page, url);
    if (!loaded) return null;

    const pageState = await classifyPageState(page);
    const ok = pageState.kind === "content";
    if (!ok) {
      await delay(4000);
      const pageState2 = await classifyPageState(page);
      if (pageState2.kind !== "content") return null;
    }

    const semanticMetadata = page.__semanticMetadata || await classifyPageSemantically(page, url, { source: "extract-ad" });

    const ad = await page.evaluate(({ adIdRx, countryCodes, currencies, titleCleanup, sel }) => {
      const body     = document.body?.innerText || "";
      const bodyHtml = document.body?.innerHTML || "";
      const adId     = adIdRx ? (window.location.pathname.match(adIdRx)?.[1] || "") : (window.location.pathname.match(/\/(\d+)(?:\.html)?$/)?.[1] || "");
      const ldJson   = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => s.textContent || "").join(" ");
      let parsedLd   = null;
      try { parsedLd = JSON.parse(ldJson); } catch {}

      const titleCandidates = sel.title.map(s => document.querySelector(s)?.innerText?.trim()).filter(Boolean);
      const titleRaw = titleCandidates[0] ||
        (parsedLd?.name || parsedLd?.headline || parsedLd?.title || "") ||
        document.title?.split(/[-|–]/)[0]?.trim() || "";
      const titleCleanupRx = titleCleanup?.length ? new RegExp(titleCleanup.join("|"), "gi") : null;
      const title = titleCleanupRx ? titleRaw.replace(titleCleanupRx, "").trim() : titleRaw;

      const skipDesc = /your\s*privacy|cookie|functional.?cookies|accept.*cookies/i;

      let description = (parsedLd?.description || "").trim();
      for (const s of sel.description) {
        const el = document.querySelector(s);
        if (el && !skipDesc.test(el.className || "")) {
          const txt = el.innerText.replace(/\s+/g, " ").trim();
          if (txt.length > 30 && !skipDesc.test(txt.slice(0, 120))) {
            description = txt.slice(0, 900);
            break;
          }
        }
      }

      if (description.length < 30) {
        const candidates = Array.from(document.querySelectorAll("div, section, article, td"))
          .filter(el => {
            const txt = el.innerText?.trim() || "";
            const cls = el.className || "";
            return txt.length > 50 && txt.length < 3000 &&
              el.querySelectorAll("a").length < 10 &&
              !skipDesc.test(cls) && !skipDesc.test(txt.slice(0, 120));
          })
          .sort((a, b) => b.innerText.length - a.innerText.length);
        if (candidates[0]) description = candidates[0].innerText.replace(/\s+/g, " ").trim().slice(0, 900);
      }

      const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'))
        .map(a => a.href.replace("tel:", "").replace(/[\s\-\.()]/g, ""))
        .filter(n => n.length >= 7 && n !== adId);

      const phoneRx = [];
      for (const code of countryCodes) {
        phoneRx.push(new RegExp(`(?:\\\\+?${code}|00${code})?0?5\\\\d{8}`, "g"));
      }
      phoneRx.push(/\+\d{8,14}/g);
      phoneRx.push(/\b0\d{9,10}\b/g);

      const phonesSet = new Set(telLinks);
      if (parsedLd?.telephone) phonesSet.add(parsedLd.telephone);
      phoneRx.forEach(rx => {
        (body.match(rx) || []).forEach(m => {
          const c = m.replace(/[\s\-\.()]/g, "");
          if (c !== adId && c.length >= 7 && c.length <= 16) phonesSet.add(c);
        });
      });
      const phones = [...phonesSet].slice(0, 5).join(" | ");

      const emailRx   = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
      const blacklist = /sentry|@2x|\.png|\.jpg|\.gif|noreply|no-reply|w3\.org|cloudflare|jquery|bootstrap|google|facebook|twitter|schema\.org|example\.com/i;
      const emailsSet = new Set([...(body.match(emailRx) || []), ...(bodyHtml.match(emailRx) || []), ...(parsedLd?.email ? [parsedLd.email] : [])]);
      const emails    = [...emailsSet]
        .filter(e => !blacklist.test(e) && e.includes(".") && e.length < 80)
        .slice(0, 3).join(" | ");

      const waEl     = document.querySelector('a[href*="wa.me"], a[href*="whatsapp.com/send"]');
      const whatsapp = waEl?.href || "";

      const locSel = sel.location.join(", ");
      const locEl   = locSel ? document.querySelector(locSel) : null;
      const location = locEl?.innerText?.trim() ||
        body.match(/(?:Location|City|Area|Country)\s*[:\-]\s*([^\n\r]{3,50})/i)?.[1]?.trim() || "";

      const currencyPattern = currencies.length ? currencies.join("|") : "USD|EUR|GBP";
      const skipPrice = /new\s+classified|for\s+sale|wanted/i;
      let price = "";
      for (const s of sel.price) {
        const el = document.querySelector(s);
        if (el) {
          const txt = el.innerText.replace(/\s+/g, " ").trim();
          if (txt.length > 0 && txt.length < 80 && !skipPrice.test(txt)) {
            price = txt;
            break;
          }
        }
      }
      if (!price) {
        price = body.match(new RegExp(`(?:Salary|Price|Compensation|Pay|Rate)\\s*[:\\-]\\s*[\\d,\\. ]+(?:${currencyPattern}|\\/month)?` +
          `|Rs\\.?\\s*[\\d,]+(?:\\.\\d+)?\\s*(?:Lacs|Crore|${currencyPattern})?` +
          `|PKR\\s*[\\d,]+(?:\\.\\d+)?` +
          `|\\b[\\d,]+\\s*(?:Lacs|Crore)\\b`, "i"))?.[0]?.trim() || "";
      }

      const compSel = sel.company.join(", ");
      const compEl  = compSel ? document.querySelector(compSel) : null;
      const company = compEl?.innerText?.trim().slice(0, 80) || "";

      const crumbSel = sel.breadcrumb.join(", ");
      const crumbs = crumbSel ? Array.from(document.querySelectorAll(crumbSel)).map(a => a.innerText.trim()).filter(Boolean).join(" › ") : "";

      const dateSel = sel.date.join(", ");
      const dateEl     = dateSel ? document.querySelector(dateSel) : null;
      const postedDate = dateEl?.getAttribute("datetime") || dateEl?.innerText?.trim() || "";

      return {
        adId, title, description, phones, emails,
        whatsapp, location, price, company,
        category: crumbs, postedDate,
        url: window.location.href,
      };
    }, {
      adIdRx: adIdPattern ? adIdPattern.source : null,
      countryCodes: extCfg.countryCodes,
      currencies: extCfg.currencies,
      titleCleanup: extCfg.titleCleanup,
      sel: extCfg.selectors,
    });

    if (!ad || !ad.adId) return null;

    const { duplicate, reason } = dedupe.isDuplicate(ad, url);
    if (duplicate) return { ...ad, _skipped: true, _skipReason: reason };

    adCache.set(url, ad);
    dedupe.mark(ad, url);
    return {
      ...ad,
      semanticPageType: semanticMetadata?.pageType || "UNKNOWN_PAGE",
      semanticConfidence: semanticMetadata?.confidence || 0,
      semanticCrawlPriority: semanticMetadata?.crawlPriority || 5,
      _semanticMetadata: semanticMetadata,
    };
  });
}

// ============================================================
//  collectAdLinks
// ============================================================

export async function collectAdLinks(pool, startUrl, config) {
  console.log(`\n📋 جمع روابط الإعلانات...`);
  const allLinks = new Set();
  let   current  = startUrl;
  let   pageNum  = 1;

  while (pageNum <= config.MAX_PAGES && allLinks.size < config.MAX_ADS) {
    const cacheKey = `page:${current}`;
    const cached   = pageCache.get(cacheKey);
    let links, nextUrl;

    if (cached) {
      ({ links, nextUrl } = cached);
      console.log(`  صفحة ${String(pageNum).padStart(2)}: 📦 cache (${links.length} رابط)`);
    } else {
      ({ links, nextUrl } = await pool.withPage(async (page) => {
        const loaded = await smartLoad(page, current);
        if (!loaded) return { links: [], nextUrl: null };

        const semanticMetadata = page.__semanticMetadata || await classifyPageSemantically(page, current, { source: "collect-ad-links" });
        const rawLinks = await page.evaluate(base => {
          return [...new Set(
            Array.from(document.querySelectorAll("a[href]"))
              .map(a => ({ href: a.href, text: a.innerText?.trim() || "" }))
              .filter(link => link.href.startsWith(base))
          )];
        }, config.BASE_URL);
        const selectedLinks = selectCandidateLinks(rawLinks, config.BASE_URL);
        const decision = decidePageAction(current, semanticMetadata, selectedLinks.map(link => ({ url: link, text: '' })));
        const linkScoreMap = new Map(decision.linkScores.filter(link => link.url).map(link => [link.url, link.score]));
        const prioritizedLinks = [...selectedLinks].sort((a, b) => (linkScoreMap.get(b) || 0) - (linkScoreMap.get(a) || 0));
        const queueScore = {
          url: current,
          score: decision.priority + (decision.linkScores[0]?.score || 0),
          sourcePageType: semanticMetadata?.pageType || 'UNKNOWN_PAGE',
          action: decision.action,
          priority: decision.priority,
        };
        console.log(`[QUEUE] URL: ${queueScore.url}`);
        console.log(`[QUEUE] SCORE: ${queueScore.score}`);
        console.log(`[QUEUE] SOURCE_PAGE_TYPE: ${queueScore.sourcePageType}`);
        const next = await page.evaluate(() => {
          return [
            document.querySelector("a[rel='next']")?.href,
            document.querySelector(".next a, a.next")?.href,
            [...document.querySelectorAll("a")].find(a => /^\s*(next|»|>)\s*$/i.test(a.textContent))?.href,
          ].find(Boolean) || null;
        });

        if (semanticMetadata?.pageType && semanticMetadata.pageType !== "UNKNOWN_PAGE") {
          console.log(`  🧠 semantic page: ${semanticMetadata.pageType} | priority=${semanticMetadata.crawlPriority}`);
        }

        return { links: prioritizedLinks, nextUrl: next };
      }));
      pageCache.set(cacheKey, { links, nextUrl });
    }

    const before   = allLinks.size;
    const newLinks = links.filter(l => !dedupe.seenUrl(l));
    newLinks.forEach(l => allLinks.add(l));
    const added = allLinks.size - before;

    console.log(
      `  صفحة ${String(pageNum).padStart(2)}: +${String(added).padStart(3)} جديد` +
      ` | ${links.length - newLinks.length} مكرر | المجموع: ${allLinks.size}`
    );

    if (!nextUrl || nextUrl === current || added === 0) break;
    current = nextUrl;
    pageNum++;
    await delay(config.PAGE_DELAY);
  }

  const result = [...allLinks].slice(0, config.MAX_ADS);
  console.log(`\n  ✅ إجمالي: ${result.length} إعلان جديد`);
  return result;
}

// ============================================================
//  runCrawl
// ============================================================

export async function runCrawl(pool, adLinks, config, hooks = {}) {
  const total      = adLinks.length;
  const allRecords = [];
  let   doneCount  = 0;

  const queue = new WorkerQueue({
    concurrency: config.CONCURRENCY ?? 3,
    maxRetries:  2,
    retryBase:   config.AD_DELAY ?? 1200,
    minDelay:    Math.floor((config.AD_DELAY ?? 1200) / (config.CONCURRENCY ?? 3)),

    onSuccess: (ad, url, idx) => {
      doneCount++;
      if (!ad) { hooks.onFail?.(url, idx, "null result"); return; }
      if (ad._skipped) {
        const icon = ad._fromCache ? "💾" : "♻️";
        console.log(`  [${String(doneCount).padStart(3)}/${total}] ${icon} ${(ad.adId||"?").padEnd(10)} | ${(ad._skipReason||"cached").padEnd(8)} | ${(ad.title||"").slice(0,40)}`);
        hooks.onSkip?.(ad, url, idx);
        return;
      }
      const icon = (ad.phones || ad.emails) ? "✅" : "📄";
      console.log(`  [${String(doneCount).padStart(3)}/${total}] ${icon} ${ad.adId.padEnd(10)} | ${(ad.title||"").slice(0,35).padEnd(35)} | 📞 ${(ad.phones||"—").slice(0,18)}`);
      allRecords.push(ad);
      hooks.onRecord?.(ad, url, idx);
    },

    onFailure: (err, url, idx) => {
      doneCount++;
      console.log(`  [${String(doneCount).padStart(3)}/${total}] ❌ ${url.split("/").pop().padEnd(20)} | ${err.message?.slice(0,45)}`);
      hooks.onFail?.(url, idx, err.message);
    },
  });

  queue.setWorker(async (url) => extractAd(pool, url));
  const promises = adLinks.map((url, i) => queue.push(url, i).catch(() => null));
  await queue.drain();
  await Promise.allSettled(promises);
  return allRecords;
}
