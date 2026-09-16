/**
 * general-mission.mjs — رحلة استقصاء واحدة
 * استطلاع: urls / مجموعة مواقع ⟵ اقتناص: crawlUrls ⟵ تحليل: classifyText + summarizeDocuments
 * ⟵ إصدار: buildReport + writeReportFiles. يقبل docs جاهزة (offline) للاختبار،
 * فيُرشّح بالـ topics المطلوبة ويصدّر التقرير.
 * يكتب ناتجَهُ دفعةً واحدة إلى طبقة C4 (documents) عبر upsertDocuments عند persist:true.
 */
import { crawlUrls, summarizeDocuments } from "./general-crawl.mjs";
import { classifyText } from "./topic-classifier.mjs";
import { buildReport, writeReportFiles } from "./report-factory.mjs";
import { flattenDocs } from "./report-factory.mjs";
import openDb, { toDocumentRow } from "./db.mjs";

export async function runMission(opts = {}) {
  const {
    urls = [],
    topics = [],
    title = "رحلة استقصاء عام",
    description = "",
    extract = {},
    fetchMode = "fetch",
    depth = 0,
    maxPages = 20,
    outputDir = "./output/reports/general",
    _docs = null,
    // قرار 1: run_id يُحقن من المتصل، والتوليد التلقائي شبكة أمان فقط
    run_id = `gc-${new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 15)}`,
    // قرار 2: الكتابة صريحة عبر persist، افتراض الإنتاج true.
    // استدعاءات الاختبار الحالية تُمرِّر persist:false صراحة.
    persist = true,
    // dbPath للبيئة الاختبارية بحقن مسار مؤقت — الإنتاج يتركه على DEFAULT_PATH
    dbPath = null,
// قرار 3: doc_type قابل للحقن (من متصل متخصّص كـ site-profile)
    docType = null,
    siteProfile = null,
  } = opts;

  const docs = _docs && Array.isArray(_docs) && _docs.length
    ? _docs
    : await crawlUrls(Array.isArray(urls) ? urls : [urls], { depth, maxPages, fetchMode, extract });

  const classified = docs.map((d) => ({
    doc: d,
    res: classifyText(`${d.title && d.title}\n${(d.metaDescription || "")}\n${(d.text || "").slice(0, 1500)}`),
  }));

  let filtered = docs;
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