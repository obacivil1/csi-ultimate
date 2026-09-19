/**
 * report-factory.mjs — مصنع التقارير (المرحلة C من وضع الاستقصاء العام)
 * أي مجموعة "وثائق" معمّمة ⟵ تقرير احترافي بعدة صيغ:
 *   report.json / report.csv / report.xlsx / report.html / deck.html (شرائح)
 * يعمل بدون أي خدمة خارجية — قابل للاختبار بشكل حتمي.
 */
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { signFiles } from "./audit-chain.mjs";
import { anchorCertificate } from "./anchor-ledger.mjs";

const TOPIC_LABELS = {
  business: "أعمال", news: "أخبار", sports: "رياضة", tech: "تقنية", health: "صحة",
  finance: "اقتصاد", jobs: "وظائف", real_estate: "عقارات", automotive: "سيارات",
  education: "تعليم", general: "عام",
};

export function topicLabel(topic) {
  return TOPIC_LABELS[topic] || topic;
}

export function flattenDocs(docs, classify = null) {
  return (docs || []).map((d) => {
    const t = classify ? classify(`${d.title && d.title}\n${(d.metaDescription || "")}\n${(d.text || "").slice(0, 1500)}`) : null;
    return {
      url: d.url,
      host: d.host,
      title: d.title || "",
      description: (d.metaDescription || "").slice(0, 300),
      chars: d.chars || 0,
      links: (d.links || []).length,
      internalLinks: d.internalLinks || 0,
      externalLinks: d.externalLinks || 0,
      images: d.images || 0,
      tables: (d.tables || []).length,
      tableRows: d.tableRows || 0,
      dominantTopic: t?.dominant?.topic || "general",
      topicPct: t?.dominant?.pct ?? null,
      emails: (d.contacts?.emails || []).join("; "),
      phones: (d.contacts?.phones || []).join("; "),
      whatsapp: (d.contacts?.whatsapp || []).join("; "),
      social: (d.contacts?.social || []).join("; "),
      hasContact: !!d.contacts?.hasAny,
    };
  });
}

function countCell(s) {
  return String(s || "").split("; ").filter(Boolean).length;
}

export function buildReport(opts = {}) {
  const {
    title = "تقرير استقصاء عام",
    description = "",
    docs = [],
    summary = null,
    classify = null,
    sources = [],
    generatedAt = new Date().toISOString(),
  } = opts;

  const rows = flattenDocs(docs, classify);

  const stats = {
    pages: rows.length,
    hosts: new Set(rows.map((r) => r.host)).size,
    chars: rows.reduce((a, r) => a + r.chars, 0),
    links: rows.reduce((a, r) => a + r.links, 0),
    images: rows.reduce((a, r) => a + r.images, 0),
    tableRows: rows.reduce((a, r) => a + r.tableRows, 0),
    contactPages: rows.filter((r) => r.hasContact).length,
    emails: rows.reduce((a, r) => a + countCell(r.emails), 0),
    phones: rows.reduce((a, r) => a + countCell(r.phones), 0),
    whatsapp: rows.reduce((a, r) => a + countCell(r.whatsapp), 0),
  };

  const topicDist = {};
  if (summary && Array.isArray(summary.topicDistribution) && summary.topicDistribution.length) {
    for (const t of summary.topicDistribution) topicDist[t.topic] = { count: t.count, pct: t.pct };
  } else {
    for (const r of rows) topicDist[r.dominantTopic] = (topicDist[r.dominantTopic] || { count: 0, pct: 0 });
    for (const k of Object.keys(topicDist)) topicDist[k].count = rows.filter((r) => r.dominantTopic === k).length;
    for (const k of Object.keys(topicDist)) topicDist[k].pct = rows.length ? Math.round((topicDist[k].count / rows.length) * 100) : 0;
  }

  const hosts = summary && Array.isArray(summary.hosts)
    ? summary.hosts
    : [...new Set(rows.map((r) => r.host))].map((host) => ({ host, pages: rows.filter((r) => r.host === host).length }));

  return {
    meta: { title, description, generatedAt, format: "general-report-v1" },
    stats,
    hosts: hosts.sort((a, b) => b.pages - a.pages),
    topics: Object.entries(topicDist)
      .map(([topic, v]) => ({ topic, label: topicLabel(topic), count: v.count, pct: v.pct }))
      .sort((a, b) => b.count - a.count || b.pct - a.pct),
    sources: [...new Set(sources)].map((s) => String(s)),
    docs: rows,
  };
}

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statCardsHtml(report) {
  const s = report.stats;
  const cards = [
    ["صفحات", s.pages], ["مضيفون", s.hosts], ["أحرف", s.chars],
    ["روابط", s.links], ["جهات تماس", s.contactPages], ["إيميلات/هواتف", `${s.emails}/${s.phones}`],
  ];
  return cards.map(([label, v]) => `<div class="card"><div class="num">${v}</div><div>${label}</div></div>`).join("");
}

export function renderHtmlReport(report) {
  const topics = report.topics.map((t) => {
    const max = Math.max(...report.topics.map((x) => x.pct), 1);
    const w = Math.max(4, Math.round((t.pct / max) * 100));
    return `<div class="topic"><span>${esc(t.label)} (${t.pct}%)</span><div class="bar"><div class="fill" style="width:${w}%"></div></div></div>`;
  }).join("");

  const hostRows = report.hosts.map((h) => `<tr><td>${esc(h.host)}</td><td>${h.pages}</td></tr>`).join("");
  const contactHosts = [...new Map(report.docs.filter((d) => d.hasContact).map((d) => [d.host, d])).values()]
    .map((d) => `<li><b>${esc(d.host)}</b> — ${esc(d.title || d.url)} → ${countCell(d.emails)} إيميل · ${countCell(d.phones)} هاتف</li>`).join("");
  const docGroups = report.docs.slice(0, 500).map((d) => `
    <tr>
      <td><a href="${esc(d.url)}">${esc(d.title || d.url)}</a></td>
      <td>${esc(d.host)}</td>
      <td>${esc(d.dominantTopic)}</td>
      <td>${d.chars}</td><td>${d.links}</td><td>${countCell(d.emails)}</td><td>${countCell(d.phones)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
  <title>${esc(report.meta.title)}</title>
  <style>
    body{font-family:Segoe UI,Tahoma,Arial;margin:0;background:#f4f6fb;color:#1c2b3a}
    header{background:#12324f;color:#fff;padding:24px 32px}
    h1{margin:0 0 6px;font-size:22px}h2{color:#12324f;margin:0 0 12px}
    .wrap{padding:24px 32px}
    .cards{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:16px 0 28px}
    .card{background:#fff;border:1px solid #dfe6ef;border-radius:10px;padding:14px;text-align:center}
    .num{font-size:22px;font-weight:700;color:#0b9f6e}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dfe6ef;border-radius:8px;overflow:hidden}
    th,td{padding:8px 10px;border-bottom:1px solid #edf1f7;text-align:right;font-size:13px}
    th{background:#eef3fa;color:#12324f}
    .bars{background:#fff;border:1px solid #dfe6ef;border-radius:10px;padding:16px;max-width:560px}
    .topic{margin:8px 0}.bar{height:10px;background:#eef3fa;border-radius:6px;overflow:hidden;margin-top:4px}
    .fill{height:100%;background:linear-gradient(90deg,#0b9f6e,#7fd3b5)}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
    footer{padding:16px 32px;font-size:12px;color:#5b6b7c}
  </style></head><body>
  <header><h1>${esc(report.meta.title)}</h1>
    <div>${esc(report.meta.description)}</div>
    <div style="font-size:13px;margin-top:6px;color:#cfe0f0">أنشئ في ${esc(report.meta.generatedAt)} · ${esc(report.sources.length)} مصادر</div></header>
  <div class="wrap">
    <div class="cards">${statCardsHtml(report)}</div>
    <div class="grid2">
      <div><h2>توزيع المواضيع</h2><div class="bars">${topics}</div></div>
      <div><h2>المضيفون</h2>
        <table><tr><th>المضيف</th><th>صفحات</th></tr>${hostRows}</table></div>
    </div>
    <h2>الوثائق (${report.docs.length})</h2>
    <table><tr><th>العنوان</th><th>المضيف</th><th>الموضوع</th><th>أحرف</th><th>روابط</th><th>إيميلات</th><th>هواتف</th></tr>${docGroups}</table>
    ${contactHosts ? `<h2>جهات تماس (<b>${report.stats.emails}</b> إيميل · <b>${report.stats.phones}</b> هاتف · <b>${report.stats.whatsapp}</b> واتساب)</h2><ul>${contactHosts}</ul>` : ""}
    <h2>المصادر</h2><ul>${report.sources.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
  </div>
  <footer>محرك CSI-Ultimate · وضع الاستقصاء العام · تقرير تلقائي</footer>
  </body></html>`;
}

export function renderHtmlDeck(report) {
  const coverCards = statCardsHtml(report);
  const topicSlides = report.topics.map((t) => {
    const docs = report.docs.filter((d) => d.dominantTopic === t.topic).slice(0, 8);
    const rows = docs.map((d) => `<li>${esc(d.host)} — <b>${esc(d.title || d.url)}</b> (${d.chars} حرف)</li>`).join("");
    return `<section class="slide"><h2>${esc(t.label)} · ${t.count} وثيقة (${t.pct}%)</h2><ul class="rows">${rows}</ul></section>`;
  }).join("");

  const hostSlide = `<section class="slide"><h2>المضيفون</h2><ul class="rows">${report.hosts.map((h) => `<li><b>${esc(h.host)}</b> — ${h.pages} صفحة</li>`).join("")}</ul></section>`;

  const contactsSlide = report.stats.contactPages > 0
    ? `<section class="slide"><h2>جهات تماس · ${report.stats.emails} إيميل · ${report.stats.phones} هاتف</h2><ul class="rows">${report.docs.filter((d) => d.hasContact).slice(0, 12).map((d) => `<li><b>${esc(d.host)}</b> — ${esc(d.title || d.url)}<br><span style="color:#9fb8d0;font-size:13px">${esc(d.emails)}${d.phones ? " · " + esc(d.phones) : ""}</span></li>`).join("")}</ul></section>`
    : "";

  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
  <title>${esc(report.meta.title)} — عرض</title>
  <style>
    body{font-family:Segoe UI,Tahoma,Arial;margin:0;background:#0d1f33}
    .slide{min-height:100vh;box-sizing:border-box;padding:56px 72px;color:#eaf1fa;background:linear-gradient(135deg,#0d1f33,#173a5c);border-bottom:6px solid #0b9f6e;display:flex;flex-direction:column;justify-content:center}
    .cover h1{font-size:44px;margin:0 0 10px}.cover p{color:#9fb8d0;font-size:18px}
    .cards{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin:36px 0}
    .card{background:rgba(255,255,255,.08);border-radius:12px;padding:18px;text-align:center}
    .num{font-size:30px;font-weight:800;color:#7fd3b5}
    h2{color:#7fd3b5;font-size:28px;margin:0 0 24px}
    .rows{list-style:none;margin:0;padding:0;font-size:16px;line-height:2}
    .rows b{color:#fff}
  </style></head><body>
  <section class="slide cover"><h1>${esc(report.meta.title)}</h1>
    <p>${esc(report.meta.description) || "تنفيذي خاص"}</p>
    <div class="cards">${coverCards}</div>
    <p style="color:#9fb8d0;font-size:14px">أنشئ في ${esc(report.meta.generatedAt)} · ${esc(report.sources.length)} مصادر</p></section>
  ${topicSlides}
  ${contactsSlide}
  ${hostSlide}
  </body></html>`;
}

function toCSV(rows) {
  const keys = rows.length ? Object.keys(rows[0]) : [];
  const escCell = (val) => {
    const s = String(val ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [keys.join(","), ...rows.map((r) => keys.map((k) => escCell(r[k])).join(","))];
  return "\uFEFF" + lines.join("\n");
}

export function writeReportFiles(report, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  const slug = report.meta.title.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, "-").replace(/^-|-$/g, "") || "report";
  const base = path.join(outputDir, slug);

  const jsonPath = `${base}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const htmlPath = `${base}.html`;
  fs.writeFileSync(htmlPath, renderHtmlReport(report), "utf8");

  const deckPath = `${base}.deck.html`;
  fs.writeFileSync(deckPath, renderHtmlDeck(report), "utf8");

  const csvPath = `${base}.csv`;
  fs.writeFileSync(csvPath, toCSV(report.docs), "utf8");

  const xlsxPath = `${base}.xlsx`;
  const ws = XLSX.utils.json_to_sheet(report.docs);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Docs");
  XLSX.writeFile(wb, xlsxPath);

  const auditPath = `${base}.audit.json`;
  let audit = null;
  let ledgerBlock = null;
  try {
    audit = signFiles([jsonPath, htmlPath, deckPath, csvPath, xlsxPath], auditPath, { label: `report:${report.meta.title}` });
    // ثبّت جذر الشهادة في سجل الـ Anchors المتسلسل (نمط v3.22)
    try {
      ledgerBlock = anchorCertificate(audit.path, { label: `report:${report.meta.title}` }).block;
    } catch { /* التثبيت اختياري — يتجاهل دون كسر التقرير */ }
  } catch { /* توقيع اختياري — يتجاهل فشل */ }

  const out = {
    dir: outputDir, json: jsonPath, html: htmlPath, deck: deckPath,
    csv: csvPath, xlsx: xlsxPath,
    audit: audit?.path ?? auditPath,
  };
  // مرجع كتلة الأنكرس (نمط v3.22) — متاح للقراءة كـ files.ledgerBlock لكنه ليس مساراً
  Object.defineProperty(out, "ledgerBlock", { value: ledgerBlock ?? null, enumerable: false });
  return out;
}