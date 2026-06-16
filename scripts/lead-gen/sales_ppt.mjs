import PptxGenJS from "pptxgenjs";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "..", "data");

// ─── Load Data ───────────────────────────────────────────────
const tenders = JSON.parse(readFileSync(join(dataDir, "etimad_all_tenders.json"), "utf8"));
const contractors = JSON.parse(readFileSync(join(dataDir, "muqawil_all_regions.json"), "utf8"));

// ─── Colors ──────────────────────────────────────────────────
const C = {
  primary: "1F3864",
  secondary: "2E75B6",
  accent: "FFD700",
  white: "FFFFFF",
  light: "D6E4F0",
  darkText: "1A1A1A",
  medium: "3B5E8A",
  green: "27AE60",
  red: "E74C3C",
  orange: "F39C12",
  gray: "95A5A6",
};

// ─── Helpers ─────────────────────────────────────────────────
const FONT = "Arial";

function headerSlide(s, titleAr, titleEn, subtitle) {
  s.background = { fill: C.primary };
  s.addText([
    { text: titleAr, options: { fontSize: 36, fontFace: FONT, color: C.white, bold: true, align: "right", rtl: true } },
    { text: "\n" + titleEn, options: { fontSize: 18, fontFace: FONT, color: C.light, align: "right" } },
  ], { x: 0.5, y: 0.3, w: 12.3, h: 1.2, rtl: true });
  if (subtitle) {
    s.addText(subtitle, { x: 0.5, y: 1.6, w: 12.3, h: 0.6, fontSize: 14, fontFace: FONT, color: C.accent, align: "right", rtl: true });
  }
}

function sectionSlide(s, titleAr, titleEn, bodyAr, bodyEn) {
  s.background = { fill: C.primary };
  headerSlide(s, titleAr, titleEn);
  s.addText(bodyAr + "\n" + bodyEn, {
    x: 0.8, y: 2.2, w: 11.5, h: 4.5,
    fontSize: 16, fontFace: FONT, color: C.white, align: "right", rtl: true, lineSpacingMultiple: 1.6,
  });
}

function contentSlide(s, titleAr, titleEn) {
  s.background = { fill: C.white };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.1, fill: { color: C.primary } });
  s.addText([
    { text: titleAr, options: { fontSize: 28, fontFace: FONT, color: C.white, bold: true, align: "right", rtl: true } },
    { text: "  |  ", options: { fontSize: 28, fontFace: FONT, color: C.accent } },
    { text: titleEn, options: { fontSize: 18, fontFace: FONT, color: C.light, align: "right" } },
  ], { x: 0.5, y: 0.15, w: 12.3, h: 0.8, rtl: true });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 1.1, w: 13.33, h: 0.06, fill: { color: C.accent } });
}

function addFooter(s, slideNum) {
  s.addText(`منتج المنافسات الحكومية | Government Tenders Database  —  ${slideNum}`, {
    x: 0.3, y: 7.0, w: 12.7, h: 0.4,
    fontSize: 9, fontFace: FONT, color: C.gray, align: "center",
  });
}

function addBulletList(s, items, opts = {}) {
  const { x = 0.8, y = 1.5, w = 11.5, h = 5.0, fontSize = 14, color = C.darkText } = opts;
  const textObjs = items.map((item, i) => ({
    text: (i > 0 ? "\n\n" : "") + `• ${item.ar}` + (item.en ? `\n  ${item.en}` : ""),
    options: { fontSize, fontFace: FONT, color, align: "right", rtl: true, lineSpacingMultiple: 1.5 },
  }));
  s.addText(textObjs, { x, y, w, h });
}

function makeTable(s, headers, rows, opts = {}) {
  const { x = 0.5, y = 1.5, w = 12.3, fontSize = 11 } = opts;
  const headerRow = headers.map(h => ({
    text: h.ar + "\n" + h.en,
    options: { fontSize: fontSize + 1, fontFace: FONT, color: C.white, bold: true, align: "right", rtl: true, fill: { color: C.primary } },
  }));
  const dataRows = rows.map((row, ri) =>
    row.map((cell, ci) => ({
      text: String(cell),
      options: {
        fontSize, fontFace: FONT, color: C.darkText,
        align: ci === 0 && headers[ci]?.ar ? "right" : "center",
        rtl: ci === 0, fill: { color: ri % 2 === 0 ? "F2F7FC" : C.white },
      },
    }))
  );
  const allRows = [headerRow, ...dataRows];
  const colW = (w - 0.2) / headers.length;
  s.addTable(allRows, {
    x, y, w: w - 0.2,
    colW: Array(headers.length).fill(colW),
    rowH: 0.45,
    border: { type: "solid", color: C.light, pt: 0.5 },
    margin: [4, 6, 4, 6],
  });
}

function addStatBox(s, x, y, w, h, number, labelAr, labelEn, bgColor = C.secondary) {
  s.addShape(pptx.ShapeType.roundRect, { x, y, w, h, fill: { color: bgColor }, rectRadius: 0.1 });
  s.addText(String(number), {
    x, y: y + 0.05, w, h: h * 0.5,
    fontSize: 28, fontFace: FONT, color: C.accent, bold: true, align: "center",
  });
  s.addText(labelAr, {
    x, y: y + h * 0.45, w, h: h * 0.3,
    fontSize: 11, fontFace: FONT, color: C.white, align: "center", rtl: true,
  });
  s.addText(labelEn, {
    x, y: y + h * 0.7, w, h: h * 0.25,
    fontSize: 9, fontFace: FONT, color: C.light, align: "center",
  });
}

// ─── Computations ────────────────────────────────────────────

// Status grouping
const statusGroups = {
  "نشطة / Active": [4],
  "منتهية / Ended": [8],
  "تم الترسية / Awarded": [5, 6, 7],
  "مؤرشفة / Archived": [15],
  "ملغية / Cancelled": [10, 11, 12, 18],
};
const allGrouped = new Set(Object.values(statusGroups).flat());
const otherIds = [...new Set(tenders.map((t) => t.tenderStatusId).filter((id) => !allGrouped.has(id)))];
statusGroups["أخرى / Other"] = otherIds;

const statusCounts = {};
for (const [label, ids] of Object.entries(statusGroups)) {
  statusCounts[label] = tenders.filter((t) => ids.includes(t.tenderStatusId)).length;
}

// Tender types
const typeCounts = {};
tenders.forEach((t) => {
  const type = t.tenderTypeName || "أخرى";
  typeCounts[type] = (typeCounts[type] || 0) + 1;
});
const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

// Top agencies
const agencyCounts = {};
tenders.forEach((t) => {
  const a = t.agencyName || "غير معروف";
  agencyCounts[a] = (agencyCounts[a] || 0) + 1;
});
const topAgencies = Object.entries(agencyCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

// Region distribution
const regionCounts = {};
contractors.forEach((c) => {
  const r = c.region_name || "غير معروف";
  regionCounts[r] = (regionCounts[r] || 0) + 1;
});
const sortedRegions = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]);

// Construction keywords
const constKeywords = ["مقاولات", "تشييد", "بناء", "إنشاء", "هدم", "ترميم", "صيانة", "تشغيل", "كهرباء", "سباكة", "طرق", "خرسانة"];
const constructionCount = tenders.filter((t) => {
  const name = (t.tenderName || "") + " " + (t.tenderActivityName || "");
  return constKeywords.some((kw) => name.includes(kw));
}).length;

// Expiring within 7 days
const now = new Date(tenders[0].currentDateTime);
const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
const expiringCount = tenders.filter((t) => {
  if (!t.lastOfferPresentationDate) return false;
  const d = new Date(t.lastOfferPresentationDate);
  return d > now && d <= sevenDays;
}).length;

// Email coverage
const withEmail = contractors.filter((c) => c.email && c.email.trim() !== "").length;
const withoutEmail = contractors.length - withEmail;

// Average booklet price
const avgPrice = tenders.reduce((s, t) => s + (t.condetionalBookletPrice || 0), 0) / tenders.length;

// Format number
const fmt = (n) => n.toLocaleString("ar-SA");

// ─── Build Presentation ──────────────────────────────────────
const pptx = new PptxGenJS();
pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
pptx.layout = "WIDE";

let slideNum = 0;

// ══════════════ Slide 1: Cover ═══════════════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  s.background = { fill: C.primary };
  // Decorative line
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 2.8, w: 13.33, h: 0.04, fill: { color: C.accent } });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 4.6, w: 13.33, h: 0.04, fill: { color: C.accent } });
  // Main title
  s.addText("منتج المنافسات الحكومية والمقاولين", {
    x: 0.5, y: 1.0, w: 12.3, h: 1.6,
    fontSize: 40, fontFace: FONT, color: C.white, bold: true, align: "center", rtl: true,
  });
  s.addText("Government Tenders & Contractors Database 2026", {
    x: 0.5, y: 3.2, w: 12.3, h: 1.2,
    fontSize: 24, fontFace: FONT, color: C.accent, align: "center",
  });
  s.addText("بيانات شاملة | منصة اعتماد + موقع مقاول", {
    x: 0.5, y: 4.9, w: 12.3, h: 0.6,
    fontSize: 16, fontFace: FONT, color: C.light, align: "center", rtl: true,
  });
  s.addText(`${fmt(tenders.length)} منافسة  |  ${fmt(contractors.length)} مقاول`, {
    x: 0.5, y: 5.6, w: 12.3, h: 0.6,
    fontSize: 18, fontFace: FONT, color: C.accent, bold: true, align: "center", rtl: true,
  });
}

// ══════════════ Slide 2: Problem ═════════════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  sectionSlide(s, "التحدي", "The Problem",
    "يواجه المقاولون صعوبة في متابعة المنافسات الحكومية المنشورة على منصة اعتماد.\n" +
    "لا توجد جهة واحدة تجمع كل المنافسات والمقاولين في مكان واحد.\n" +
    "تضيع الفرص بسبب ضيق الوقت وعدم التنبيه بالتحديثات.\n" +
    "يحتاج المقاولون إلى بذل جهد كبير لجمع بيانات العملاء المحتملين.",
    "Contractors struggle to track government tenders published on Etimad platform.\n" +
    "No single source aggregates all tenders and contractors in one place.\n" +
    "Opportunities are missed due to tight deadlines and lack of alerts.\n" +
    "Contractors spend enormous effort gathering potential client data.");
  addFooter(s, slideNum);
}

// ══════════════ Slide 3: Solution ════════════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  sectionSlide(s, "الحل", "The Solution",
    "منتج شامل يجمّع جميع المنافسات الحكومية من منصة اعتماد مع بيانات المقاولين من موقع مقاول.\n" +
    "لوحة بيانات تفاعلية مع تنبيهات فورية عند نشر منافسات جديدة.\n" +
    `قاعدة بيانات تضم ${fmt(tenders.length)} منافسة و ${fmt(contractors.length)} مقاول.` +
    "\nفلترة ذكية حسب المنطقة، النشاط، الجهة، والحالة.",
    "A comprehensive product aggregating all government tenders from Etimad\n" +
    `with contractor data from Muqawil. Database of ${fmt(tenders.length)} tenders and ${fmt(contractors.length)} contractors.` +
    "\nInteractive dashboard with instant alerts on new tender publications.\nSmart filtering by region, activity, agency, and status.");
  addFooter(s, slideNum);
}

// ══════════════ Slide 4: Data Sources ════════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "مصادر البيانات", "Data Sources");
  // Two big boxes
  const boxH = 2.0;
  const boxY = 1.6;
  const gap = 0.3;
  const boxW = (12.3 - gap) / 2;

  // Etimad box
  s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: boxY, w: boxW, h: boxH, fill: { color: "EBF5FB" }, rectRadius: 0.15 });
  s.addText("منصة اعتماد\nEtimad Platform", { x: 0.5, y: boxY + 0.1, w: boxW, h: 0.6, fontSize: 18, fontFace: FONT, color: C.primary, bold: true, align: "center", rtl: true });
  s.addText(fmt(tenders.length), { x: 0.5, y: boxY + 0.7, w: boxW, h: 0.5, fontSize: 32, fontFace: FONT, color: C.secondary, bold: true, align: "center" });
  s.addText("منافسة حكومية\nGovernment Tenders", { x: 0.5, y: boxY + 1.2, w: boxW, h: 0.6, fontSize: 13, fontFace: FONT, color: C.darkText, align: "center", rtl: true });

  // Muqawil box
  s.addShape(pptx.ShapeType.roundRect, { x: 0.5 + boxW + gap, y: boxY, w: boxW, h: boxH, fill: { color: "FEF9E7" }, rectRadius: 0.15 });
  s.addText("موقع مقاول\nMuqawil.org", { x: 0.5 + boxW + gap, y: boxY + 0.1, w: boxW, h: 0.6, fontSize: 18, fontFace: FONT, color: C.primary, bold: true, align: "center", rtl: true });
  s.addText(fmt(contractors.length), { x: 0.5 + boxW + gap, y: boxY + 0.7, w: boxW, h: 0.5, fontSize: 32, fontFace: FONT, color: C.orange, bold: true, align: "center" });
  s.addText("مقاول ومؤسسة\nContractors & Companies", { x: 0.5 + boxW + gap, y: boxY + 1.2, w: boxW, h: 0.6, fontSize: 13, fontFace: FONT, color: C.darkText, align: "center", rtl: true });

  // Bottom stats
  const statY = 4.0;
  addStatBox(s, 0.5, statY, 2.8, 1.5, fmt(constructionCount), "منافسة إنشائية", "Construction Tenders", C.secondary);
  addStatBox(s, 3.8, statY, 2.8, 1.5, fmt(expiringCount), "منافسة تنتهي قريباً", "Expiring within 7 days", C.red);
  addStatBox(s, 7.1, statY, 2.8, 1.5, fmt(withoutEmail), "مقاول بدون بريد", "Contractors w/o Email", C.orange);
  addStatBox(s, 10.4, statY, 2.8, 1.5, fmt(withEmail), "مقاول مع بريد إلكتروني", "Contractors with Email", C.green);

  addFooter(s, slideNum);
}

// ══════════════ Slide 5: Tenders by Status (PIE CHART) ═══════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "تصنيف المنافسات حسب الحالة", "Tenders by Status");

  const labels = Object.keys(statusCounts);
  const values = Object.values(statusCounts);
  const total = values.reduce((a, b) => a + b, 0);

  // Table instead of chart (charts in pptxgenjs are unreliable)
  const rows = labels.map((label, i) => [
    label,
    fmt(values[i]),
    (values[i] / total * 100).toFixed(1) + "%",
  ]);
  makeTable(s, [
    { ar: "الحالة", en: "Status" },
    { ar: "العدد", en: "Count" },
    { ar: "النسبة", en: "Percentage" },
  ], rows, { y: 1.5, fontSize: 12 });

  addFooter(s, slideNum);
}

// ══════════════ Slide 6: Top Agencies ════════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "أهم الجهات الحكومية", "Top Government Agencies");

  const totalTenders = tenders.length;
  const rows = topAgencies.map(([name, count], i) => [
    String(i + 1),
    name,
    fmt(count),
    (count / totalTenders * 100).toFixed(1) + "%",
  ]);
  makeTable(s, [
    { ar: "#", en: "#" },
    { ar: "الجهة", en: "Agency" },
    { ar: "عدد المنافسات", en: "Tenders" },
    { ar: "النسبة", en: "Share" },
  ], rows, { y: 1.5 });
  addFooter(s, slideNum);
}

// ══════════════ Slide 7: Tender Types (PIE TABLE) ════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "أنواع المنافسات", "Tender Types");

  const total = tenders.length;
  const rows = sortedTypes.map(([type, count]) => [
    type,
    fmt(count),
    (count / total * 100).toFixed(1) + "%",
  ]);
  makeTable(s, [
    { ar: "النوع", en: "Type" },
    { ar: "العدد", en: "Count" },
    { ar: "النسبة", en: "Percentage" },
  ], rows, { y: 1.5 });
  addFooter(s, slideNum);
}

// ══════════════ Slide 8: Contractors by Region ═══════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "المقاولون حسب المنطقة", "Contractors by Region");

  const total = contractors.length;
  const rows = sortedRegions.map(([region, count]) => [
    region,
    fmt(count),
    (count / total * 100).toFixed(1) + "%",
  ]);
  makeTable(s, [
    { ar: "المنطقة", en: "Region" },
    { ar: "العدد", en: "Count" },
    { ar: "النسبة", en: "Percentage" },
  ], rows, { y: 1.5 });
  addFooter(s, slideNum);
}

// ══════════════ Slide 9: Live Tenders Feed ═══════════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "تغذية حية للمنافسات", "Live Tenders Feed");

  addBulletList(s, [
    { ar: "الوصول الفوري لجميع المنافسات الحكومية المنشورة", en: "Instant access to all published government tenders" },
    { ar: "تحديث يومي مباشر من منصة اعتماد", en: "Daily live updates directly from Etimad platform" },
    { ar: `${fmt(tenders.length)} منافسة متاحة للتصفح والبحث`, en: `${fmt(tenders.length)} tenders available for browsing and searching` },
    { ar: "عرض تفاصيل كاملة: المواعيد، القيمة، الجهة، النشاط", en: "Full details: deadlines, value, agency, activity" },
    { ar: "تصدير البيانات إلى Excel أو CSV", en: "Export data to Excel or CSV" },
  ], { y: 1.5 });
  // Feature highlight box
  s.addShape(pptx.ShapeType.roundRect, { x: 0.8, y: 5.2, w: 11.5, h: 1.2, fill: { color: "EBF5FB" }, rectRadius: 0.1 });
  s.addText("عينة مجانية: 50 منافسة حية تجريبية | Free Sample: 50 live tenders for trial", {
    x: 0.8, y: 5.3, w: 11.5, h: 1.0,
    fontSize: 16, fontFace: FONT, color: C.primary, bold: true, align: "center", rtl: true,
  });
  addFooter(s, slideNum);
}

// ══════════════ Slide 10: Contractor Database ════════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "قاعدة بيانات المقاولين", "Contractor Database");

  addBulletList(s, [
    { ar: `${fmt(contractors.length)} مقاول ومؤسسة مسجلة لدى موقع مقاول`, en: `${fmt(contractors.length)} contractors registered on Muqawil.org` },
    { ar: `بيانات الاتصال: ${fmt(withEmail)} منهم لديهم بريد إلكتروني`, en: `Contact data: ${fmt(withEmail)} have email addresses` },
    { ar: "تصنيف حسب الدرجة، الحجم، المنطقة والنشاط", en: "Classification by grade, size, region, and activity" },
    { ar: "معلومات التصنيف: الدرجة، عدد الموظفين، التقييم", en: "Classification info: grade, employee count, ratings" },
    { ar: "إمكانية التواصل المباشر مع المقاولين المستهدفين", en: "Direct contact with target contractors" },
  ], { y: 1.5 });
  addFooter(s, slideNum);
}

// ══════════════ Slide 11: Construction Focus ═════════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "التركيز على المقاولات", "Construction Focus");

  // Big number display
  s.addShape(pptx.ShapeType.roundRect, { x: 1.5, y: 1.5, w: 10.3, h: 2.0, fill: { color: "EBF5FB" }, rectRadius: 0.15 });
  s.addText(fmt(constructionCount), {
    x: 1.5, y: 1.6, w: 10.3, h: 1.0,
    fontSize: 48, fontFace: FONT, color: C.primary, bold: true, align: "center",
  });
  s.addText("منافسة إنشائية متاحة | Construction Tenders Available", {
    x: 1.5, y: 2.7, w: 10.3, h: 0.6,
    fontSize: 18, fontFace: FONT, color: C.secondary, align: "center", rtl: true,
  });

  addBulletList(s, [
    { ar: "تصفية المنافسات حسب الأنشطة الإنشائية الرئيسية", en: "Filter tenders by key construction activities" },
    { ar: "يشمل: مقاولات، تشييد، بناء، إنشاء، ترميم، صيانة...", en: "Includes: contracting, construction, building, maintenance..." },
    { ar: `يمثل ${(constructionCount / tenders.length * 100).toFixed(1)}% من إجمالي المنافسات`, en: `Represents ${(constructionCount / tenders.length * 100).toFixed(1)}% of all tenders` },
  ], { y: 3.8, fontSize: 14 });
  addFooter(s, slideNum);
}

// ══════════════ Slide 12: Urgency Alerts ═════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "تنبيهات العاجلة", "Urgency Alerts");

  // Big urgent number
  s.addShape(pptx.ShapeType.roundRect, { x: 1.5, y: 1.5, w: 10.3, h: 2.0, fill: { color: "FDEDEC" }, rectRadius: 0.15 });
  s.addText(fmt(expiringCount), {
    x: 1.5, y: 1.6, w: 10.3, h: 1.0,
    fontSize: 48, fontFace: FONT, color: C.red, bold: true, align: "center",
  });
  s.addText("منافسة تنتهي خلال 7 أيام | Tenders Expiring Within 7 Days", {
    x: 1.5, y: 2.7, w: 10.3, h: 0.6,
    fontSize: 18, fontFace: FONT, color: C.red, align: "center", rtl: true,
  });

  addBulletList(s, [
    { ar: "تنبيهات فورية عند اقتراب موعد إغلاق المنافسة", en: "Instant alerts when tender deadline approaches" },
    { ar: "إشعارات عبر البريد الإلكتروني والواتساب", en: "Notifications via email and WhatsApp" },
    { ar: "تصفية حسب تاريخ التقديم لاستهداف الفرص العاجلة", en: "Filter by submission date to target urgent opportunities" },
    { ar: "لا تفوت أي فرصة مرة أخرى", en: "Never miss an opportunity again" },
  ], { y: 3.8, fontSize: 14 });
  addFooter(s, slideNum);
}

// ══════════════ Slide 13: Smart Filters ══════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "التصفية الذكية", "Smart Filters");

  const filters = [
    { ar: "المنطقة", en: "Region", desc: `${sortedRegions.length} منطقة مختلفة` },
    { ar: "النشاط", en: "Activity", desc: "أكثر من 500 نشاط تجاري" },
    { ar: "الجهة الحكومية", en: "Agency", desc: `${Object.keys(agencyCounts).length} جهة حكومية` },
    { ar: "حالة المنافسة", en: "Status", desc: `${Object.keys(statusCounts).length} حالات مختلفة` },
    { ar: "السعر", en: "Price Range", desc: `متوسط سعر الكراسة ${Math.round(avgPrice)} ريال` },
    { ar: "التاريخ", en: "Date Range", desc: "تصفية حسب تاريخ التقديم" },
  ];

  const perRow = 3;
  const boxW = 3.5;
  const boxH = 1.6;
  const startX = 0.8;
  const startY = 1.5;
  const gapX = 0.5;
  const gapY = 0.4;

  filters.forEach((f, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = startX + col * (boxW + gapX);
    const y = startY + row * (boxH + gapY);
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: boxW, h: boxH, fill: { color: "F2F7FC" }, rectRadius: 0.1 });
    s.addText(f.ar, { x, y: y + 0.1, w: boxW, h: 0.4, fontSize: 14, fontFace: FONT, color: C.primary, bold: true, align: "center", rtl: true });
    s.addText(f.en, { x, y: y + 0.45, w: boxW, h: 0.3, fontSize: 11, fontFace: FONT, color: C.secondary, align: "center" });
    s.addText(f.desc, { x, y: y + 0.9, w: boxW, h: 0.5, fontSize: 12, fontFace: FONT, color: C.darkText, align: "center", rtl: true });
  });
  addFooter(s, slideNum);
}

// ══════════════ Slide 14: Pricing Table ══════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "خطط الأسعار", "Pricing Plans");

  const plans = [
    {
      nameAr: "أساسي", nameEn: "Basic", price: "500", pricePeriod: "ريال/شهر",
      features: ["50 منافسة شهرياً", "بريد إلكتروني دعم", "تحديث أسبوعي", "تصدير Excel"],
      bg: "EBF5FB", btn: C.secondary,
    },
    {
      nameAr: "احترافي", nameEn: "Professional", price: "1,200", pricePeriod: "ريال/شهر",
      features: ["جميع المنافسات", "بيانات المقاولين", "تنبيهات فورية", "دعم فني 24/7", "تصدير CSV+Excel"],
      bg: "FEF9E7", btn: C.primary,
    },
    {
      nameAr: "مؤسسي", nameEn: "Enterprise", price: "3,000", pricePeriod: "ريال/شهر",
      features: ["API مخصص", "تقارير متقدمة", "مدير حساب", "تكامل مع أنظمتك", "جميع البيانات غير محدود"],
      bg: "EBF5FB", btn: C.secondary,
    },
  ];

  const pW = 3.5;
  const pH = 4.5;
  const startX = 0.8;
  const gap = 0.35;
  const pY = 1.5;

  plans.forEach((p, i) => {
    const x = startX + i * (pW + gap);
    s.addShape(pptx.ShapeType.roundRect, { x, y: pY, w: pW, h: pH, fill: { color: p.bg }, rectRadius: 0.15, line: { color: C.light, width: 1 } });
    // Plan name
    s.addText(p.nameAr, { x, y: pY + 0.1, w: pW, h: 0.35, fontSize: 16, fontFace: FONT, color: C.primary, bold: true, align: "center", rtl: true });
    s.addText(p.nameEn, { x, y: pY + 0.4, w: pW, h: 0.25, fontSize: 11, fontFace: FONT, color: C.secondary, align: "center" });
    // Price
    s.addText(p.price + "\n" + p.pricePeriod, { x, y: pY + 0.7, w: pW, h: 0.7, fontSize: 20, fontFace: FONT, color: C.darkText, bold: true, align: "center", rtl: true });
    // Divider
    s.addShape(pptx.ShapeType.rect, { x: x + 0.3, y: pY + 1.5, w: pW - 0.6, h: 0.02, fill: { color: C.light } });
    // Features
    const featText = p.features.map((f) => `✓ ${f}`).join("\n");
    s.addText(featText, { x: x + 0.2, y: pY + 1.6, w: pW - 0.4, h: 2.0, fontSize: 11, fontFace: FONT, color: C.darkText, align: "center", rtl: true, lineSpacingMultiple: 1.6 });
    // Button
    if (i === 1) {
      s.addShape(pptx.ShapeType.roundRect, { x: x + 0.3, y: pY + pH - 0.7, w: pW - 0.6, h: 0.5, fill: { color: C.accent }, rectRadius: 0.08 });
      s.addText("الأكثر طلباً", { x: x + 0.3, y: pY + pH - 0.7, w: pW - 0.6, h: 0.5, fontSize: 12, fontFace: FONT, color: C.darkText, bold: true, align: "center", rtl: true });
    }
  });
  addFooter(s, slideNum);
}

// ══════════════ Slide 15: ROI ═════════════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "العائد على الاستثمار", "Return on Investment");

  s.addShape(pptx.ShapeType.roundRect, { x: 0.8, y: 1.5, w: 11.5, h: 2.5, fill: { color: "E8F8F5" }, rectRadius: 0.15 });
  s.addText("💡  فكرة | Concept", { x: 0.8, y: 1.6, w: 11.5, h: 0.4, fontSize: 18, fontFace: FONT, color: C.green, bold: true, align: "center", rtl: true });
  s.addText(
    "متوسط قيمة المنافسة الحكومية يتجاوز 500,000 ريال سعودي\n" +
    "اشتراك احترافي لمدة سنة = 14,400 ريال فقط\n" +
    "فوز بمنافسة واحدة فقط يغطي 34 سنة من الاشتراك!\n\n" +
    "The average government tender value exceeds 500,000 SAR\n" +
    "One year Professional subscription = only 14,400 SAR\n" +
    "Winning just one tender covers 34 years of subscription!",
    { x: 0.8, y: 2.0, w: 11.5, h: 1.8, fontSize: 14, fontFace: FONT, color: C.darkText, align: "center", rtl: true, lineSpacingMultiple: 1.5 }
  );

  // Stat boxes for ROI
  const roiData = [
    { num: `${(500000 / 1200).toFixed(0)}x`, labelAr: "ضعف الراتب الشهري", labelEn: "Monthly salary multiple" },
    { num: `${(500000 / 14400).toFixed(0)}`, labelAr: "سنة تغطية", labelEn: "Years covered" },
    { num: "500K+", labelAr: "متوسط قيمة المنافسة", labelEn: "Avg tender value (SAR)" },
  ];
  roiData.forEach((d, i) => {
    addStatBox(s, 0.8 + i * 4.1, 4.3, 3.5, 1.5, d.num, d.labelAr, d.labelEn, C.primary);
  });
  addFooter(s, slideNum);
}

// ══════════════ Slide 16: Free Trial ═════════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "نسخة تجريبية مجانية", "Free Trial");

  s.addShape(pptx.ShapeType.roundRect, { x: 1.0, y: 1.5, w: 11.3, h: 4.5, fill: { color: "FEF9E7" }, rectRadius: 0.2, line: { color: C.accent, width: 2 } });
  s.addText("7 أيام تجربة مجانية | 7-Day Free Trial", {
    x: 1.0, y: 1.7, w: 11.3, h: 0.7,
    fontSize: 28, fontFace: FONT, color: C.primary, bold: true, align: "center", rtl: true,
  });
  s.addText([
    { text: "✓ 50 منافسة حية تجريبية", options: { fontSize: 16, color: C.darkText, rtl: true } },
    { text: "\n✓ تجربة كاملة للمنصة", options: { fontSize: 16, color: C.darkText, rtl: true } },
    { text: "\n✓ لا حاجة لبطاقة ائتمانية", options: { fontSize: 16, color: C.darkText, rtl: true } },
    { text: "\n✓ دعم فني مجاني خلال التجربة", options: { fontSize: 16, color: C.darkText, rtl: true } },
    { text: "\n\nابدأ رحلة نجاحك اليوم!", options: { fontSize: 20, color: C.primary, bold: true, rtl: true } },
    { text: "\nStart your success journey today!", options: { fontSize: 14, color: C.secondary } },
  ], { x: 1.5, y: 2.6, w: 10.3, h: 3.0, align: "center", rtl: true, fontFace: FONT, lineSpacingMultiple: 1.5 });
  addFooter(s, slideNum);
}

// ══════════════ Slide 17: Sample Data ════════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "نموذج من البيانات", "Sample Data");

  const samples = tenders.slice(0, 5).map((t, i) => [
    String(i + 1),
    t.tenderName || "",
    t.agencyName || "",
    t.tenderTypeName || "",
    fmt(t.condetionalBookletPrice || 0),
  ]);
  makeTable(s, [
    { ar: "#", en: "#" },
    { ar: "اسم المنافسة", en: "Tender Name" },
    { ar: "الجهة", en: "Agency" },
    { ar: "النوع", en: "Type" },
    { ar: "سعر الكراسة", en: "Price" },
  ], samples, { y: 1.5, fontSize: 10 });
  s.addText(`عرض 5 من أصل ${fmt(tenders.length)} منافسة | Displaying 5 of ${fmt(tenders.length)} tenders`, {
    x: 0.5, y: 5.5, w: 12.3, h: 0.5,
    fontSize: 12, fontFace: FONT, color: C.gray, align: "center", rtl: true,
  });
  addFooter(s, slideNum);
}

// ══════════════ Slide 18: Data Freshness ═════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "تحديث البيانات", "Data Freshness");

  addBulletList(s, [
    { ar: "تحديث يومي مباشر من منصة اعتماد", en: "Daily live updates from Etimad platform" },
    { ar: "مزامنة آلية مع موقع مقاول للمقاولين", en: "Automatic sync with Muqawil.org for contractors" },
    { ar: "آخر تحديث: " + tenders[0].currentDate, en: "Last update: " + tenders[0].currentDate },
    { ar: "متوسط سعر الكراسة: " + Math.round(avgPrice) + " ريال", en: "Average booklet price: " + Math.round(avgPrice) + " SAR" },
    { ar: `${sortedTypes.length} أنواع مختلفة من المنافسات`, en: `${sortedTypes.length} different tender types` },
  ], { y: 1.5 });

  // Freshens indicators
  s.addShape(pptx.ShapeType.roundRect, { x: 0.8, y: 5.0, w: 3.5, h: 1.2, fill: { color: "E8F8F5" }, rectRadius: 0.1 });
  s.addText("✓ محدث يومياً\nDaily Updates", { x: 0.8, y: 5.1, w: 3.5, h: 1.0, fontSize: 12, fontFace: FONT, color: C.green, align: "center", rtl: true, bold: true });

  s.addShape(pptx.ShapeType.roundRect, { x: 4.8, y: 5.0, w: 3.5, h: 1.2, fill: { color: "EBF5FB" }, rectRadius: 0.1 });
  s.addText("✓ مصدر رسمي\nOfficial Source", { x: 4.8, y: 5.1, w: 3.5, h: 1.0, fontSize: 12, fontFace: FONT, color: C.secondary, align: "center", rtl: true, bold: true });

  s.addShape(pptx.ShapeType.roundRect, { x: 8.8, y: 5.0, w: 3.5, h: 1.2, fill: { color: "FEF9E7" }, rectRadius: 0.1 });
  s.addText("✓ دقة عالية\nHigh Accuracy", { x: 8.8, y: 5.1, w: 3.5, h: 1.0, fontSize: 12, fontFace: FONT, color: C.orange, align: "center", rtl: true, bold: true });

  addFooter(s, slideNum);
}

// ══════════════ Slide 19: Security & Reliability ═════════════
slideNum++;
{
  const s = pptx.addSlide();
  contentSlide(s, "الأمان والموثوقية", "Security & Reliability");

  addBulletList(s, [
    { ar: "بيانات مباشرة من منصة اعتماد الحكومية الرسمية", en: "Direct data from official Etimad government platform" },
    { ar: `مصدر موثوق: ${Object.keys(agencyCounts).length} جهة حكومية`, en: `Trusted source: ${Object.keys(agencyCounts).length} government agencies` },
    { ar: "بيانات المقاولين من موقع مقاول المعتمد", en: "Contractor data from the accredited Muqawil.org" },
    { ar: "خوادم آمنة مع نسخ احتياطي يومي", en: "Secure servers with daily backups" },
    { ar: "التزام كامل بخصوصية البيانات", en: "Full commitment to data privacy" },
  ], { y: 1.5 });
  addFooter(s, slideNum);
}

// ══════════════ Slide 20: Contact ═════════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  s.background = { fill: C.primary };

  headerSlide(s, "تواصل معنا", "Contact Us");

  const contactY = 2.0;
  const contactH = 1.0;
  const contactW = 5.5;

  const contacts = [
    { icon: "📞", labelAr: "واتساب", labelEn: "WhatsApp", value: "+966 50 000 0000" },
    { icon: "✉️", labelAr: "البريد الإلكتروني", labelEn: "Email", value: "info@government-tenders.com" },
    { icon: "🌐", labelAr: "الموقع الإلكتروني", labelEn: "Website", value: "www.government-tenders.com" },
    { icon: "📍", labelAr: "المقر", labelEn: "Location", value: "الرياض، المملكة العربية السعودية" },
  ];

  contacts.forEach((c, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 1.0 + col * (contactW + 0.8);
    const y = contactY + row * (contactH + 0.3);
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: contactW, h: contactH, fill: { color: "1A2E50" }, rectRadius: 0.1 });
    s.addText(c.icon + "  " + c.value, { x, y: y + 0.1, w: contactW, h: 0.5, fontSize: 18, fontFace: FONT, color: C.white, align: "center" });
    s.addText(c.labelAr + " | " + c.labelEn, { x, y: y + 0.55, w: contactW, h: 0.35, fontSize: 13, fontFace: FONT, color: C.accent, align: "center", rtl: true });
  });
}

// ══════════════ Slide 21: Call to Action ═════════════════════
slideNum++;
{
  const s = pptx.addSlide();
  s.background = { fill: C.primary };

  // Top accent line
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.06, fill: { color: C.accent } });

  s.addText("اطلب نسختك التجريبية الآن", {
    x: 0.5, y: 1.5, w: 12.3, h: 1.2,
    fontSize: 36, fontFace: FONT, color: C.white, bold: true, align: "center", rtl: true,
  });
  s.addText("Get Your Free Trial Now", {
    x: 0.5, y: 2.7, w: 12.3, h: 0.8,
    fontSize: 22, fontFace: FONT, color: C.accent, align: "center",
  });

  // CTA Button
  s.addShape(pptx.ShapeType.roundRect, { x: 3.5, y: 3.8, w: 6.3, h: 0.9, fill: { color: C.accent }, rectRadius: 0.12 });
  s.addText("💬  تواصل معنا عبر واتساب  |  Contact via WhatsApp", {
    x: 3.5, y: 3.9, w: 6.3, h: 0.7,
    fontSize: 18, fontFace: FONT, color: C.darkText, bold: true, align: "center", rtl: true,
  });

  // Bottom features
  const features = ["7 أيام تجربة مجانية", "50 منافسة تجريبية", "دعم فني متكامل", "لا بطاقة ائتمانية"];
  features.forEach((f, i) => {
    const x = 1.5 + i * 2.8;
    s.addText(`✓ ${f}`, { x, y: 5.3, w: 2.5, h: 0.5, fontSize: 14, fontFace: FONT, color: C.light, align: "center", rtl: true });
  });

  s.addText("© 2026 Government Tenders Database. جميع الحقوق محفوظة.", {
    x: 0.5, y: 6.5, w: 12.3, h: 0.5,
    fontSize: 10, fontFace: FONT, color: C.gray, align: "center", rtl: true,
  });
}

console.log(`Slide count: ${slideNum}`);

// ─── Save ────────────────────────────────────────────────────
const outDir = join(__dirname, "..", "..", "presentations");
const outPath = join(outDir, "Government_Tenders_Product.pptx");
await pptx.writeFile({ fileName: outPath });
console.log(`Saved to: ${outPath}`);
