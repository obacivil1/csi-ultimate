/**
 * general-mission.mjs — رحلة استقصاء واحدة
 * استطلاع: urls / مجموعة مواقع ⟵ اقتناص: crawlUrls ⟵ تحليل: classifyText + summarizeDocuments
 * ⟵ إصدار: buildReport + writeReportFiles. يقبل docs جاهزة (offline) للاختبار،
 * فيُرشّح بالـ topics المطلوبة ويصدّر التقرير.
 */
import { crawlUrls, summarizeDocuments } from "./general-crawl.mjs";
import { classifyText } from "./topic-classifier.mjs";
import { buildReport, writeReportFiles } from "./report-factory.mjs";

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
  })), summary, report, files };
}