/**
 * general-mission.mjs — رحلة استقصاء واحدة
 * استطلاع: urls / مجموعة مواقع ⟵ اقتناص: crawlUrls ⟵ تحليل: classifyText + summarizeDocuments
 * ⟵ إصدار: buildReport + writeReportFiles. يقبل docs جاهزة (offline) للاختبار،
 * فيُرشّح بالـ topics المطلوبة ويصدّر التقرير.
 * يكتب ناتجَهُ دفعةً واحدة إلى طبقة C4 (documents) عبر upsertDocuments عند persist:true.
 * يدعم وضع الخصوصية (opt-in) وتخطي المتصفح للصفحات الديناميكية.
 */
import { crawlUrls, summarizeDocuments } from "./general-crawl.mjs";
import { classifyText } from "./topic-classifier.mjs";
import { buildReport, writeReportFiles } from "./report-factory.mjs";
import { flattenDocs } from "./report-factory.mjs";
import openDb, { toDocumentRow } from "./db.mjs";
import { applyMaskPolicies, DEFAULT_POLICY } from "./privacy-mask.mjs";

// Security validation for mission parameters
const validateUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const validateFetchMode = (mode) => ["fetch", "playwright"].includes(mode);
const validateNonNegativeInt = (val) => {
  const n = parseInt(val, 10);
  return !isNaN(n) && n >= 0;
};
const validatePositiveInt = (val) => {
  const n = parseInt(val, 10);
  return !isNaN(n) && n > 0;
};
const validateMaxPages = (val) => validatePositiveInt(val) && parseInt(val, 10) <= 1000;

export async function runMission(opts = {}) {
  // [FIX-8] Input validation - security hardening
  let {
    urls = [], topics = [], title = "رحلة استقصاء عام", description = "",
    fetchMode = "fetch", depth = 0, maxPages = 20, outputDir = "./output/reports/general",
    _docs = null, run_id, persist = true, dbPath = null,
    docType = null, siteProfile = null, privacy = false,
  } = opts;

  // Validate URLs
  const validUrls = (Array.isArray(urls) ? urls : [urls]).filter(u => validateUrl(u));
  if (validUrls.length === 0) {
    console.error("⚠️ No valid URLs provided for mission");
    return { error: "invalid URLs", status: "failed" };
  }

  // Validate fetchMode
  if (!validateFetchMode(fetchMode)) {
    console.error("⚠️ Invalid fetchMode, using default 'fetch'");
    fetchMode = "fetch";
  }

  // Validate depth and maxPages
  if (!validateNonNegativeInt(depth)) {
    console.error("⚠️ Invalid depth value, using default 0");
    depth = 0;
  }
  if (!validateMaxPages(maxPages)) {
    console.error("⚠️ Invalid maxPages value, using default 20");
    maxPages = 20;
  }

  // Sanitize title and description
  title = (String(title) || "رحلة استقصاء عام").slice(0, 200);
  description = (String(description) || "").slice(0, 500);

  // Ensure output directory is safe
  const safeOutputDir = outputDir.replace(/[^a-z0-9\u0600-\u06FF\-]/g, "-");
  
  // validated parameters
  const validatedOpts = {
    urls: validUrls,
    topics: topics.length ? topics : undefined,
    title,
    description: description || (Array.isArray(validUrls) && validUrls.length ? `استقصاء: ${validUrls.length} روابط` : "استقصاء عام"),
    fetchMode,
    depth,
    maxPages,
    outputDir: safeOutputDir,
    _docs: _docs,
    run_id: run_id || `gc-${new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 15)}`,
    persist,
    dbPath,
    docType,
    siteProfile,
    privacy,
  };

  const docs = _docs && Array.isArray(_docs) && _docs.length
    ? _docs
    : await crawlUrls(Array.isArray(urls) ? urls : [urls], { depth, maxPages, fetchMode, extract: undefined });

  // Apply privacy masking if opt-in enabled (Deny by default: privacy:false = no masking)
  let maskedDocs = docs;
  if (privacy === true) {
    const { docs: masked, log } = applyMaskPolicies(docs, DEFAULT_POLICY);
    maskedDocs = masked;
    if (log.length) console.info(`[privacy] Masking applied to ${log.length} documents (Deny-by-default: fields disabled unless policy enabled)`);
  }

  const classified = maskedDocs.map((d) => ({
    doc: d,
    res: classifyText(`${d.title && d.title}\n${(d.metaDescription || "")}\n${(d.text || "").slice(0, 1500)}`),
  }));

  let filtered = maskedDocs;
  if (Array.isArray(topics) && topics.length) {
    const wanted = new Set(topics);
    filtered = classified
      .filter((c) => wanted.has(c.res.dominant?.topic))
      .map((c) => c.doc);
  }

  // قرار 3: doc_type بأولوية site-profile ثم استنتاج التصنيف ثم fallback عام.
  // المرتبة 2 تستقبل suggestedType إن أضافه مصنّف مستقبلاً (غير موجود اليوم).
  const classifyIndex = new Map(docs.map((d, i) => [d, i]));
  const rows = filtered.map((d) => {
    const idx = classifyIndex.get(d);
    const res = idx != null ? classified[idx]?.res : null;
    const doc_type = siteProfile?.doc_type
      ?? docType
      ?? res?.suggestedType
      ?? "document";
    return toDocumentRow(d, {
      doc_type,
      topic: res?.dominant?.topic || null,
      run_id,
      canonical: flattenDocs([d], classifyText)[0],
    });
  });

  // C4: كتابة دفعة واحدة — transaction واحد، لا اندماج جزئي
  let persisted = null;
  if (persist) {
    const db = openDb(dbPath || undefined);
    try {
      persisted = db.upsertDocuments(rows);
    } finally {
      db.close();
    }
  }

  const summary = summarizeDocuments(filtered, classifyText);
  const report = buildReport({
    title,
    description: description || (Array.isArray(topics) && topics.length ? `المواضيع: ${topics.join("، ")}` : "استقصاء عام"),
    docs: filtered,
    summary,
    classify: classifyText,
    sources: urls,
  });
  const files = writeReportFiles(report, outputDir);

  return { docs: filtered.map((d) => ({
    url: d.url, host: d.host, title: d.title, chars: d.chars,
    links: d.links.length, images: d.images, tables: d.tables.length,
  })), summary, report, files, run_id, persisted };
}